import type { MemoryCategory, MemoryScope, MemoryStatus, SmartMemorySettings } from './types.js';
import { MEMORY_CATEGORIES } from './types.js';
import type { SmartMemoryStore } from './store.js';
import type { ExtractionEngine } from './extraction.js';
import { asString, safeError, truncate } from './util.js';

export interface ApiDeps {
  ctx: any;
  store: SmartMemoryStore;
  engine: ExtractionEngine;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

const API_PREFIX = '/api/smart-memory';

type Handler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

function ok(value: unknown): Response {
  return Response.json({ ok: true, value });
}

function fail(message: string, code = 'bad-request', status = 200): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function log(deps: ApiDeps, level: 'info' | 'warn' | 'error', message: string) {
  const fn = deps.logger?.[level];
  if (typeof fn === 'function') fn.call(deps.logger, `[smart-memory] ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asScope(value: unknown): MemoryScope | 'all' {
  return value === 'global' || value === 'project' ? value : 'all';
}

function asCategory(value: unknown): MemoryCategory | undefined {
  return typeof value === 'string' && (MEMORY_CATEGORIES as readonly string[]).includes(value) ? (value as MemoryCategory) : undefined;
}

function asStatus(value: unknown): MemoryStatus | undefined {
  return value === 'active' || value === 'archived' || value === 'pending_confirmation' || value === 'conflict' || value === 'expired'
    ? value
    : undefined;
}

function parseLimit(value: unknown, fallback: number, max = 500): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.round(number)));
}

/**
 * Mount the browser-facing HTTP API on DSH Connection's shared `/api` channel.
 * The route registry is the same seam used by the bundled usage plugin; it does
 * not require this plugin's fiber to own a web server.
 */
export function registerApiRoutes(deps: ApiDeps): void {
  const { ctx, store, engine } = deps;
  const handlers = new Map<string, Handler>();

  handlers.set('health', () => ({
    ok: true,
    plugin: 'dsh-smart-memory',
    version: '1.0.0',
    dsh: '0.2.2-rc.1',
    storagePath: store.storagePath,
    memories: store.stats().total,
  }));

  handlers.set('overview', () => store.overview());

  handlers.set('memories', async (args) => {
    const scope = args['scope'] === 'global' || args['scope'] === 'project' ? args['scope'] : 'all';
    const projectId = asString(args['projectId']) || undefined;
    const status = asStatus(args['status']);
    const listed = store.listMemories({
      scope: scope === 'all' ? 'all' : scope,
      ...projectId === undefined ? {} : { projectId },
      query: asString(args['query']),
      category: asCategory(args['category']),
      ...status === undefined ? {} : { status },
      includeArchived: args['includeArchived'] === true || status === 'archived' || status === 'expired',
      limit: parseLimit(args['limit'], 100, 500),
      offset: Math.max(0, Number(args['offset']) || 0),
    });
    return {
      total: listed.total,
      memories: listed.memories,
      project: projectId ? store.getProject(projectId) ?? null : null,
    };
  });

  handlers.set('save', async (args) => {
    const scope = args['scope'] === 'project' ? 'project' : 'global';
    const projectId = asString(args['projectId']) || undefined;
    if (scope === 'project') {
      if (!projectId) throw new Error('项目记忆必须指定 projectId');
      if (!store.getProject(projectId)) throw new Error(`项目不存在：${projectId}`);
    }
    const result = await store.saveMemory({
      scope,
      ...projectId === undefined ? {} : { projectId },
      title: asString(args['title']),
      content: asString(args['content']),
      category: asCategory(args['category']),
      tags: Array.isArray(args['tags']) ? (args['tags'] as string[]).filter((tag) => typeof tag === 'string') : [],
      importance: args['importance'] === undefined ? 3 : Number(args['importance']),
      confidence: args['confidence'] === undefined ? 0.85 : Number(args['confidence']),
      pinned: args['pinned'] === true,
      locked: args['locked'] === true,
      source: { kind: 'ui' },
      allowDuplicate: args['allowDuplicate'] === true,
    });
    return result;
  });

  handlers.set('update', async (args) => {
    const id = asString(args['id']);
    if (!id) throw new Error('缺少记忆 id');
    const memory = await store.updateMemory(id, {
      title: args['title'] === undefined ? undefined : asString(args['title']),
      content: args['content'] === undefined ? undefined : asString(args['content']),
      category: asCategory(args['category']),
      tags: Array.isArray(args['tags']) ? (args['tags'] as string[]).filter((tag) => typeof tag === 'string') : undefined,
      importance: args['importance'] === undefined ? undefined : Number(args['importance']),
      confidence: args['confidence'] === undefined ? undefined : Number(args['confidence']),
      pinned: typeof args['pinned'] === 'boolean' ? args['pinned'] : undefined,
      locked: typeof args['locked'] === 'boolean' ? args['locked'] : undefined,
      status: asStatus(args['status']),
      force: args['force'] === true,
      source: { kind: 'ui' },
    });
    return { memory };
  });

  handlers.set('delete', async (args) => {
    const id = asString(args['id']);
    if (!id) throw new Error('缺少记忆 id');
    const deleted = await store.deleteMemory(id, { kind: 'ui' });
    return { deleted, id };
  });

  handlers.set('pin', async (args) => {
    const id = asString(args['id']);
    if (!id) throw new Error('缺少记忆 id');
    const memory = await store.setPinned(id, args['pinned'] !== false);
    return { memory };
  });

  handlers.set('lock', async (args) => {
    const id = asString(args['id']);
    if (!id) throw new Error('缺少记忆 id');
    const memory = await store.setLocked(id, args['locked'] !== false);
    return { memory };
  });

  handlers.set('projects', () => ({ projects: store.listProjects() }));

  handlers.set('project', (args) => {
    const id = asString(args['id']);
    if (!id) throw new Error('缺少项目 id');
    const project = store.getProject(id);
    if (!project) throw new Error(`项目不存在：${id}`);
    return {
      project,
      memories: store.listMemories({ scope: 'project', projectId: id, limit: 500, includeArchived: true }),
    };
  });

  handlers.set('project/rename', async (args) => {
    const id = asString(args['id']);
    const name = asString(args['name']);
    if (!id) throw new Error('缺少项目 id');
    const project = await store.renameProject(id, name);
    return { project };
  });

  handlers.set('project/clear', async (args) => {
    if (args['confirm'] !== true) throw new Error('清除项目记忆必须 confirm=true');
    const id = asString(args['id']);
    if (!id) throw new Error('缺少项目 id');
    const deleted = await store.clearProject(id, { kind: 'ui' });
    return { deleted, projectId: id };
  });

  handlers.set('settings/get', () => ({
    settings: store.getSettings(),
    storagePath: store.storagePath,
    version: '1.0.0',
  }));

  handlers.set('settings/update', async (args) => {
    const patch = asRecord(args['settings'] ?? args);
    const settings = await store.updateSettings(patch as Partial<SmartMemorySettings>);
    if (settings.autoArchiveDays > 0) {
      void store.archiveOld().catch((error) => log(deps, 'warn', `archive after settings update failed: ${safeError(error)}`));
    }
    engine.schedule();
    return { settings, storagePath: store.storagePath };
  });

  handlers.set('export', (args) => {
    const scope = asScope(args['scope']);
    const projectId = asString(args['projectId']) || undefined;
    if (scope === 'project' && !projectId) throw new Error('项目导出必须指定 projectId');
    return store.exportBundle(scope, projectId, args['includeSettings'] === true);
  });

  handlers.set('import', async (args) => {
    const mode = args['mode'] === 'replace' ? 'replace' : 'merge';
    if (mode === 'replace' && args['confirm'] !== true) throw new Error('替换导入必须 confirm=true');
    let data = args['data'];
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        throw new Error('导入内容不是有效 JSON');
      }
    }
    if (!data || typeof data !== 'object') throw new Error('导入内容必须是对象');
    const result = await store.importBundle(data, mode, { kind: 'ui' });
    engine.schedule();
    return result;
  });

  handlers.set('forget', async (args) => {
    if (args['confirm'] !== true) throw new Error('清除记忆必须 confirm=true');
    const scope = args['scope'] === 'global' ? 'global' : args['scope'] === 'project' ? 'project' : 'all';
    const projectId = asString(args['projectId']) || undefined;
    if (scope === 'project' && !projectId) throw new Error('清除项目记忆必须指定 projectId');
    let deleted = 0;
    if (scope === 'global') deleted = await store.forgetScope('global', undefined, { kind: 'ui' });
    else if (scope === 'project') deleted = await store.clearProject(projectId!, { kind: 'ui' });
    else {
      // The UI's "all" is an explicit user action and may clear every project.
      deleted = await store.forgetScope('all', undefined, { kind: 'ui' });
    }
    return { deleted, scope, projectId: projectId ?? null };
  });

  handlers.set('audit', (args) => ({ records: store.listAudit(parseLimit(args['limit'], 50, 500)) }));
  handlers.set('jobs', (args) => ({ jobs: store.listJobs(parseLimit(args['limit'], 50, 500)) }));
  handlers.set('status', () => ({ ...store.overview(), runtime: store.getRuntimeStatus() }));

  const mount = (connection: any) => {
    const fetchRegistry = connection?.fetch;
    if (!fetchRegistry || typeof fetchRegistry.register !== 'function') {
      log(deps, 'warn', 'connection.fetch registry unavailable; memory UI API not mounted');
      return;
    }
    let mounted = 0;
    for (const [endpoint, handler] of handlers) {
      const path = `${API_PREFIX}/${endpoint}`;
      try {
        fetchRegistry.register({
          path,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request: Request) => {
            if (request.method !== 'POST') return fail('method not allowed', 'method-not-allowed', 405);
            let args: Record<string, unknown> = {};
            const text = await request.text();
            if (text.length > 0) {
              if (text.length > 2_000_000) return fail('请求体过大', 'too-large', 413);
              try {
                const parsed = JSON.parse(text);
                args = asRecord(parsed);
              } catch {
                return fail('请求体不是有效 JSON', 'bad-json', 400);
              }
            }
            try {
              const value = await handler(args);
              return ok(value);
            } catch (error) {
              const message = safeError(error);
              log(deps, 'warn', `${endpoint} failed: ${message}`);
              return fail(truncate(message, 500), 'operation-failed');
            }
          },
        });
        mounted += 1;
      } catch (error) {
        log(deps, 'warn', `failed to mount ${path}: ${safeError(error)}`);
      }
    }
    log(deps, 'info', `mounted ${mounted}/${handlers.size} memory API routes on ${API_PREFIX}`);
  };

  ctx.inject(['connection'], (connectionCtx: any) => {
    mount(connectionCtx.connection);
  });
}
