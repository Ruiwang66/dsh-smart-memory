import type { MemoryCategory, MemoryRecord, MemoryStatus, ProjectRecord } from './types.js';
import { CATEGORY_LABELS, MEMORY_CATEGORIES, SCOPE_LABELS } from './types.js';
import type { SmartMemoryStore } from './store.js';
import { asString, redactSensitive, safeError, truncate } from './util.js';

export interface ToolRuntimeDeps {
  ctx: any;
  store: SmartMemoryStore;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

type Exec = {
  agent?: any;
  callId?: string;
  signal?: AbortSignal;
};

const SCOPE_ENUM = ['auto', 'global', 'project'] as const;
const STATUS_ENUM = ['active', 'archived', 'pending_confirmation', 'conflict', 'expired'] as const;
const CATEGORY_ENUM = [...MEMORY_CATEGORIES];

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    ...required.length === 0 ? {} : { required },
    additionalProperties: false,
  };
}

function outputSchema() {
  return { type: 'object', additionalProperties: true };
}

function text(value: string) {
  return [{ type: 'text', text: value }];
}

function memoryLine(memory: MemoryRecord): string {
  const flags = [
    memory.pinned ? '固定' : '',
    memory.locked ? '锁定' : '',
    memory.status !== 'active' ? memory.status : '',
  ].filter(Boolean);
  const meta = [SCOPE_LABELS[memory.scope], CATEGORY_LABELS[memory.category], `重要度${memory.importance}`, ...flags].join('/');
  return `- [${memory.id}] ${memory.title}（${meta}）：${truncate(memory.content, 240)}`;
}

function projectContextLabel(project: ProjectRecord | undefined): string {
  return project ? `${project.name}（${project.rootPath}）` : '未识别';
}

function log(deps: ToolRuntimeDeps, level: 'info' | 'warn' | 'error', message: string) {
  const fn = deps.logger?.[level];
  if (typeof fn === 'function') fn.call(deps.logger, `[smart-memory] ${message}`);
}

function safeService(ctx: any, name: string): any {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

async function currentProject(deps: ToolRuntimeDeps, exec: Exec): Promise<ProjectRecord | undefined> {
  const cwd = exec.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || !cwd) return undefined;
  const candidate = deps.store.resolveProjectCandidate(cwd);
  if (!candidate) return undefined;
  return deps.store.ensureProject(candidate, exec.agent?.session?.id);
}

async function requireProject(deps: ToolRuntimeDeps, exec: Exec): Promise<ProjectRecord> {
  const project = await currentProject(deps, exec);
  if (!project) throw new Error('当前会话没有可识别的项目工作目录，无法使用项目记忆；请先进入项目目录');
  return project;
}

function assertAccessible(memory: MemoryRecord, project: ProjectRecord | undefined): void {
  if (memory.scope === 'global') return;
  if (!project || memory.projectId !== project.id) {
    throw new Error('该记忆属于其他项目，当前会话不能访问；项目记忆严格隔离');
  }
}

async function requireApproval(
  deps: ToolRuntimeDeps,
  exec: Exec,
  toolName: string,
  reason: string,
): Promise<void> {
  const approval = safeService(deps.ctx, 'approval');
  if (!approval || typeof approval.request !== 'function') {
    throw new Error('该操作需要用户确认，但当前会话没有可用的审批服务；请改用记忆管理界面操作');
  }
  if (!exec.agent) throw new Error('该操作需要用户确认，但当前调用没有所属会话');
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    ...exec.callId === undefined ? {} : { callId: exec.callId },
    reason,
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') throw new Error(`用户未批准该操作（${String(outcome)}）`);
}

function validateScope(value: unknown): 'auto' | 'global' | 'project' {
  return value === 'global' || value === 'project' ? value : 'auto';
}

function validateStatus(value: unknown): MemoryStatus | undefined {
  return (STATUS_ENUM as readonly string[]).includes(asString(value)) ? (value as MemoryStatus) : undefined;
}

function validateCategory(value: unknown): MemoryCategory | undefined {
  return (MEMORY_CATEGORIES as readonly string[]).includes(asString(value)) ? (value as MemoryCategory) : undefined;
}

function auditDetail(args: unknown): string {
  try {
    return truncate(JSON.stringify(args), 800);
  } catch {
    return '';
  }
}

/**
 * Register the 11 model-facing memory tools. Every mutation is checked against
 * the current project, so a tool call cannot read or write another project's
 * private memory by guessing an id.
 */
export function registerMemoryTools(deps: ToolRuntimeDeps): void {
  const { ctx, store } = deps;
  const register = (definition: Record<string, unknown>) => {
    try {
      ctx.tools.register(definition);
    } catch (error) {
      log(deps, 'error', `failed to register ${String(definition['name'])}: ${safeError(error)}`);
      throw error;
    }
  };

  register({
    name: 'memory_search',
    description:
      '搜索长期记忆。默认同时搜索全局记忆与当前项目记忆；项目记忆严格按当前工作目录隔离。中文使用 BM25 + 字符 n-gram 混合检索。',
    parameters: objectSchema({
      query: { type: 'string', description: '检索词；留空则按重要度与最近更新时间返回。' },
      scope: { type: 'string', enum: [...SCOPE_ENUM], description: 'auto（默认，全局+当前项目）、global、project。' },
      category: { type: 'string', enum: CATEGORY_ENUM, description: '可选分类过滤。' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选标签过滤（任一匹配）。' },
      limit: { type: 'integer', description: '返回数量，1-30，默认 8。' },
      includeArchived: { type: 'boolean', description: '是否包含已归档/过期记忆，默认 false。' },
    }),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => {
        const memories: MemoryRecord[] = value?.memories ?? [];
        if (memories.length === 0) return text('没有找到匹配的记忆。');
        return text(`找到 ${value.total ?? memories.length} 条相关记忆：\n${memories.map(memoryLine).join('\n')}`);
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>, exec: Exec) {
      const scope = validateScope(args['scope']);
      const project = await currentProject(deps, exec);
      if (scope === 'project' && !project) throw new Error('当前会话没有可识别的项目，无法搜索项目记忆');
      const query = asString(args['query']);
      const limit = Math.max(1, Math.min(30, Number(args['limit']) || 8));
      const results = store.search({
        query,
        scope,
        projectId: project?.id,
        category: validateCategory(args['category']),
        tags: Array.isArray(args['tags']) ? (args['tags'] as string[]).filter((tag) => typeof tag === 'string') : undefined,
        includeArchived: args['includeArchived'] === true,
        limit,
      });
      const memories = results.map((entry) => entry.memory);
      const detail = auditDetail({ query, scope, count: memories.length });
      await store.appendAudit({
        actor: 'tool',
        action: 'memory.search',
        scope: scope === 'auto' ? 'all' : scope,
        projectId: project?.id,
        sessionId: exec.agent?.session?.id,
        detail: store.getSettings().sensitiveFilter ? redactSensitive(detail) : detail,
        ok: true,
      });
      return {
        total: memories.length,
        query,
        scope,
        project: project ? { id: project.id, name: project.name, rootPath: project.rootPath } : null,
        memories: memories.map((memory) => ({
          id: memory.id,
          scope: memory.scope,
          projectId: memory.projectId ?? null,
          title: memory.title,
          content: memory.content,
          category: memory.category,
          tags: memory.tags,
          importance: memory.importance,
          pinned: memory.pinned,
          locked: memory.locked,
          status: memory.status,
          updatedAt: memory.updatedAt,
          source: memory.source,
        })),
      };
    },
  });

  register({
    name: 'memory_save',
    description:
      '保存一条值得长期保留的新记忆。全局记忆记录用户稳定偏好、背景、语言、风格、工具、长期要求或纠正；项目记忆记录当前项目的技术决策、进度、问题、接口、数据库、部署、环境、计划或失败尝试。不要保存一次性信息、闲聊或密钥。',
    parameters: objectSchema(
      {
        scope: { type: 'string', enum: ['global', 'project'], description: 'global 为用户全局记忆；project 为当前项目记忆。' },
        title: { type: 'string', description: '简短标题，最多 200 字。' },
        content: { type: 'string', description: '完整、具体、可复用的长期事实。' },
        category: { type: 'string', enum: CATEGORY_ENUM, description: '记忆分类。' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签。' },
        importance: { type: 'integer', description: '重要度 1-5，默认 3。' },
        confidence: { type: 'number', description: '置信度 0-1，默认 0.8。' },
        pinned: { type: 'boolean', description: '是否固定；固定记忆优先召回。' },
        locked: { type: 'boolean', description: '是否锁定；锁定后自动更新不能覆盖。' },
      },
      ['scope', 'title', 'content'],
    ),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => {
        if (value?.skipped) return text(`未保存：与已锁定记忆冲突或内容重复（${value.memory?.id ?? 'unknown'}）。`);
        if (value?.created) return text(`已保存记忆 [${value.memory.id}] ${value.memory.title}（${SCOPE_LABELS[value.memory.scope as keyof typeof SCOPE_LABELS] ?? value.memory.scope}）。`);
        if (value?.conflict) return text(`发现冲突，已创建待确认记忆 [${value.memory.id}] ${value.memory.title}，旧记忆已标记为冲突。`);
        return text(`已合并到现有记忆 [${value.memory.id}] ${value.memory.title}。`);
      },
    },
    async execute(args: Record<string, unknown>, exec: Exec) {
      const scope = args['scope'] === 'project' ? 'project' : 'global';
      const project = scope === 'project' ? await requireProject(deps, exec) : undefined;
      const result = await store.saveMemory({
        scope,
        ...project === undefined ? {} : { projectId: project.id },
        title: asString(args['title']),
        content: asString(args['content']),
        category: validateCategory(args['category']),
        tags: Array.isArray(args['tags']) ? (args['tags'] as string[]).filter((tag) => typeof tag === 'string') : [],
        importance: Number(args['importance']) || 3,
        confidence: args['confidence'] === undefined ? 0.8 : Number(args['confidence']),
        pinned: args['pinned'] === true,
        locked: args['locked'] === true,
        source: {
          kind: 'manual',
          ...exec.agent?.session?.id === undefined ? {} : { sessionId: exec.agent.session.id },
        },
      });
      return {
        created: result.created,
        merged: result.merged,
        conflict: result.conflict,
        skipped: result.skipped === true,
        memory: {
          id: result.memory.id,
          scope: result.memory.scope,
          projectId: result.memory.projectId ?? null,
          title: result.memory.title,
          content: result.memory.content,
          category: result.memory.category,
          importance: result.memory.importance,
          pinned: result.memory.pinned,
          locked: result.memory.locked,
          status: result.memory.status,
        },
        project: project ? { id: project.id, name: project.name, rootPath: project.rootPath } : null,
      };
    },
  });

  register({
    name: 'memory_update',
    description:
      '更新一条已有记忆。可修改标题、内容、分类、标签、重要度、置信度、固定、锁定或状态。项目记忆只能修改当前项目的记录。锁定记忆需要 force=true。',
    parameters: objectSchema(
      {
        id: { type: 'string', description: '记忆 id（mem_...）。' },
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string', enum: CATEGORY_ENUM },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'integer', description: '1-5。' },
        confidence: { type: 'number', description: '0-1。' },
        pinned: { type: 'boolean' },
        locked: { type: 'boolean' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        force: { type: 'boolean', description: '锁定记忆必须显式 force=true。' },
      },
      ['id'],
    ),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => text(`已更新记忆 [${value.memory.id}] ${value.memory.title}。`),
    },
    async execute(args: Record<string, unknown>, exec: Exec) {
      const id = asString(args['id']);
      const memory = store.getMemory(id);
      if (!memory) throw new Error(`记忆不存在：${id}`);
      const project = await currentProject(deps, exec);
      assertAccessible(memory, project);
      const updated = await store.updateMemory(id, {
        title: args['title'] === undefined ? undefined : asString(args['title']),
        content: args['content'] === undefined ? undefined : asString(args['content']),
        category: validateCategory(args['category']),
        tags: Array.isArray(args['tags']) ? (args['tags'] as string[]).filter((tag) => typeof tag === 'string') : undefined,
        importance: args['importance'] === undefined ? undefined : Number(args['importance']),
        confidence: args['confidence'] === undefined ? undefined : Number(args['confidence']),
        pinned: typeof args['pinned'] === 'boolean' ? args['pinned'] : undefined,
        locked: typeof args['locked'] === 'boolean' ? args['locked'] : undefined,
        status: validateStatus(args['status']),
        force: args['force'] === true,
        source: {
          kind: 'manual',
          ...exec.agent?.session?.id === undefined ? {} : { sessionId: exec.agent.session.id },
        },
      });
      return { memory: updated };
    },
  });

  register({
    name: 'memory_delete',
    description:
      '删除一条记忆。必须显式 confirm=true。若记忆已固定或锁定，会先请求用户一次性批准；项目记忆只能删除当前项目的记录。',
    parameters: objectSchema(
      {
        id: { type: 'string', description: '记忆 id。' },
        confirm: { type: 'boolean', description: '必须为 true，表示确认删除。' },
      },
      ['id', 'confirm'],
    ),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => text(value.deleted ? `已删除记忆 ${value.id}。` : `记忆 ${value.id} 不存在。`),
    },
    async execute(args: Record<string, unknown>, exec: Exec) {
      if (args['confirm'] !== true) throw new Error('删除记忆必须显式设置 confirm=true');
      const id = asString(args['id']);
      const memory = store.getMemory(id);
      if (!memory) return { deleted: false, id };
      const project = await currentProject(deps, exec);
      assertAccessible(memory, project);
      if (memory.pinned || memory.locked) {
        await requireApproval(deps, exec, 'memory_delete', `删除${memory.pinned ? '固定' : '锁定'}记忆「${memory.title}」`);
      }
      const deleted = await store.deleteMemory(id, {
        kind: 'manual',
        ...exec.agent?.session?.id === undefined ? {} : { sessionId: exec.agent.session.id },
      });
      return { deleted, id };
    },
  });

  register({
    name: 'memory_list',
    description:
      '列出记忆。默认列出当前项目与全局的活跃记忆，可按范围、分类、标签、状态过滤。项目记忆严格隔离。',
    parameters: objectSchema({
      scope: { type: 'string', enum: [...SCOPE_ENUM], description: 'auto/global/project，默认 auto。' },
      query: { type: 'string', description: '可选搜索词。' },
      category: { type: 'string', enum: CATEGORY_ENUM },
      status: { type: 'string', enum: [...STATUS_ENUM], description: '指定状态；默认只返回活跃记忆。' },
      includeArchived: { type: 'boolean' },
      limit: { type: 'integer', description: '1-100，默认 30。' },
      offset: { type: 'integer', description: '分页偏移。' },
    }),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => {
        const memories: MemoryRecord[] = value?.memories ?? [];
        if (memories.length === 0) return text('没有记忆。');
        return text(`共 ${value.total} 条，当前显示 ${memories.length} 条：\n${memories.map(memoryLine).join('\n')}`);
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>, exec: Exec) {
      const scope = validateScope(args['scope']);
      const project = await currentProject(deps, exec);
      if (scope === 'project' && !project) throw new Error('当前会话没有可识别的项目');
      const limit = Math.max(1, Math.min(100, Number(args['limit']) || 30));
      const offset = Math.max(0, Number(args['offset']) || 0);
      const listed = store.listMemories({
        scope,
        projectId: project?.id,
        query: asString(args['query']),
        category: validateCategory(args['category']),
        status: validateStatus(args['status']),
        includeArchived: args['includeArchived'] === true,
        limit,
        offset,
      });
      return {
        total: listed.total,
        limit,
        offset,
        project: project ? { id: project.id, name: project.name } : null,
        memories: listed.memories,
      };
    },
  });

  for (const pinned of [true, false]) {
    const name = pinned ? 'memory_pin' : 'memory_unpin';
    register({
      name,
      description: pinned
        ? '固定一条重要记忆。固定记忆会在召回时优先加载。'
        : '取消固定一条记忆。',
      parameters: objectSchema({ id: { type: 'string', description: '记忆 id。' } }, ['id']),
      output: {
        schema: outputSchema(),
        render: (_args: unknown, value: any) => text(`记忆 [${value.memory.id}] 已${pinned ? '固定' : '取消固定'}。`),
      },
      async execute(args: Record<string, unknown>, exec: Exec) {
        const id = asString(args['id']);
        const memory = store.getMemory(id);
        if (!memory) throw new Error(`记忆不存在：${id}`);
        const project = await currentProject(deps, exec);
        assertAccessible(memory, project);
        const updated = await store.setPinned(id, pinned);
        return { memory: updated };
      },
    });
  }

  register({
    name: 'memory_stats',
    description: '查看记忆统计：总数、全局/项目数量、活跃/归档/待确认数量、固定数量、队列状态和存储占用。',
    parameters: objectSchema({}),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) =>
        text(
          `记忆总数 ${value.total}（全局 ${value.global}，项目 ${value.project}）；活跃 ${value.active}，归档 ${value.archived}，待确认 ${value.pending}，固定 ${value.pinned}；项目 ${value.projects} 个；自动队列 ${value.queueDepth} 项；存储约 ${Math.round((value.storageBytes ?? 0) / 1024)} KB。`,
        ),
    },
    isConcurrencySafe: () => true,
    async execute() {
      return store.stats();
    },
  });

  register({
    name: 'memory_export',
    description:
      '导出记忆为 DSH Smart Memory JSON。scope=global 导出全局；project 导出当前项目；all 导出全局+当前项目（不会导出其他项目）。大数据量建议在记忆管理界面导出。',
    parameters: objectSchema({
      scope: { type: 'string', enum: ['global', 'project', 'all'], description: '默认 all（全局+当前项目）。' },
      includeArchived: { type: 'boolean', description: '是否包含归档记忆。' },
    }),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => {
        const summary = `已导出 ${value.memories.length} 条记忆（格式 ${value.format} v${value.version}）。`;
        let json = '';
        try {
          json = JSON.stringify(value);
        } catch {
          json = '';
        }
        return text(json.length > 0 && json.length <= 20_000 ? `${summary}\n${json}` : `${summary}数据较大，请在“设置 → 智能记忆”界面导出。`);
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>, exec: Exec) {
      const scope = args['scope'] === 'global' ? 'global' : args['scope'] === 'project' ? 'project' : 'all';
      const project = await currentProject(deps, exec);
      if (scope === 'project' && !project) throw new Error('当前会话没有可识别的项目');
      const globalBundle = scope === 'global' || scope === 'all' ? store.exportBundle('global') : undefined;
      const projectBundle = scope === 'project' || scope === 'all' ? store.exportBundle('project', project?.id) : undefined;
      const memories = [...(globalBundle?.memories ?? []), ...(projectBundle?.memories ?? [])].filter(
        (memory) => args['includeArchived'] === true || (memory.status !== 'archived' && memory.status !== 'expired'),
      );
      return {
        format: 'dsh-smart-memory',
        version: 1,
        exportedAt: Date.now(),
        scope,
        project: project ? { id: project.id, name: project.name } : null,
        memories,
      };
    },
  });

  register({
    name: 'memory_import',
    description:
      '导入 DSH Smart Memory JSON。默认 merge 合并；replace 会先清空现有记忆，必须显式 confirm=true 并请求用户批准。项目记忆只能导入到当前项目。',
    parameters: objectSchema(
      {
        data: { type: 'object', description: 'memory_export 返回的完整 JSON 对象。' },
        mode: { type: 'string', enum: ['merge', 'replace'], description: '默认 merge。' },
        confirm: { type: 'boolean', description: 'replace 模式必须为 true。' },
      },
      ['data'],
    ),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) =>
        text(`导入完成：新增 ${value.imported} 条，更新 ${value.updated} 条，跳过 ${value.skipped} 条，项目 ${value.projects} 个。`),
    },
    async execute(args: Record<string, unknown>, exec: Exec) {
      const mode = args['mode'] === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace') {
        if (args['confirm'] !== true) throw new Error('replace 导入必须显式 confirm=true');
        await requireApproval(deps, exec, 'memory_import', '用导入数据替换全部记忆');
      }
      const project = await currentProject(deps, exec);
      const data = args['data'];
      if (!data || typeof data !== 'object') throw new Error('data 必须是 memory_export 返回的 JSON 对象');
      const bundle = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
      if (Array.isArray(bundle['memories'])) {
        // Project records are host-owned; never accept another project's id from
        // a model tool call. Keep only global memories and current-project ones.
        const filtered = (bundle['memories'] as unknown[]).filter((raw) => {
          if (!raw || typeof raw !== 'object') return false;
          const record = raw as Record<string, unknown>;
          if (record['scope'] === 'global') return true;
          return record['scope'] === 'project' && project && record['projectId'] === project.id;
        });
        bundle['memories'] = filtered;
        bundle['projects'] = [];
      }
      const replaceIds = mode === 'replace'
        ? store.allMemories()
            .filter((memory) => memory.scope === 'global' || (project !== undefined && memory.projectId === project.id))
            .map((memory) => memory.id)
        : undefined;
      const result = await store.importBundle(bundle, mode, {
        kind: 'import',
        ...exec.agent?.session?.id === undefined ? {} : { sessionId: exec.agent.session.id },
      }, replaceIds);
      return result;
    },
  });

  register({
    name: 'memory_forget',
    description:
      '按范围清除记忆。必须显式 confirm=true，并且始终请求用户一次性批准。scope=global 清除全局；project 清除当前项目；all 清除全局+当前项目（不会影响其他项目）。',
    parameters: objectSchema(
      {
        scope: { type: 'string', enum: ['global', 'project', 'all'], description: '清除范围。' },
        confirm: { type: 'boolean', description: '必须为 true。' },
      },
      ['scope', 'confirm'],
    ),
    output: {
      schema: outputSchema(),
      render: (_args: unknown, value: any) => text(`已清除 ${value.deleted} 条${value.scope === 'global' ? '全局' : value.scope === 'project' ? '当前项目' : '全局与当前项目'}记忆。`),
    },
    async execute(args: Record<string, unknown>, exec: Exec) {
      if (args['confirm'] !== true) throw new Error('清除记忆必须显式 confirm=true');
      const scope = args['scope'] === 'global' ? 'global' : args['scope'] === 'project' ? 'project' : 'all';
      const project = scope === 'project' || scope === 'all' ? await currentProject(deps, exec) : undefined;
      if (scope === 'project' && !project) throw new Error('当前会话没有可识别的项目');
      await requireApproval(
        deps,
        exec,
        'memory_forget',
        scope === 'global'
          ? '清除全部全局记忆'
          : scope === 'project'
            ? `清除项目「${project?.name}」的全部记忆`
            : '清除全局记忆与当前项目的全部记忆',
      );
      let deleted = 0;
      if (scope === 'global') deleted = await store.forgetScope('global', undefined, { kind: 'manual' });
      else if (scope === 'project') deleted = await store.clearProject(project!.id, { kind: 'manual' });
      else {
        deleted += await store.forgetScope('global', undefined, { kind: 'manual' });
        if (project) deleted += await store.clearProject(project.id, { kind: 'manual' });
      }
      return { deleted, scope, project: project ? { id: project.id, name: project.name } : null };
    },
  });
}
