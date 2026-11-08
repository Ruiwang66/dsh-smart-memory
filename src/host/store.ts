import fs from 'node:fs';
import type {
  AuditRecord,
  ExportBundle,
  ExtractionJob,
  MemoryCategory,
  MemoryRecord,
  MemoryScope,
  MemorySource,
  MemoryStats,
  MemoryStatus,
  OverviewData,
  ProjectRecord,
  ProjectSummary,
  RankedMemory,
  SearchOptions,
  SmartMemorySettings,
} from './types.js';
import {
  CATEGORY_LABELS,
  DEFAULT_SETTINGS,
  MEMORY_CATEGORIES,
} from './types.js';
import { MemoryIndex, selectRecallMemories } from './retrieval.js';
import type { ProjectCandidate, WorkspaceHint } from './project.js';
import { detectProject } from './project.js';
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  clamp,
  directorySize,
  estimateTokens,
  isIgnoredPath,
  newId,
  normalizeText,
  normalizedTitle,
  now,
  redactSensitive,
  safeError,
  shortHash,
  truncate,
} from './util.js';

interface KvTable {
  get(key: string): unknown;
  entries(): IterableIterator<[string, unknown]>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteMany(keys: string[]): Promise<number>;
}

export interface DomainHandle {
  name: string;
  table(name: string): KvTable;
  close(): Promise<void>;
}

export interface StoreRuntimeStatus {
  lastExtractionAt?: number;
  lastExtractionError?: string;
  lastMode?: 'llm' | 'heuristic';
  processing: boolean;
}

export interface SaveMemoryInput {
  scope: MemoryScope;
  projectId?: string;
  category?: MemoryCategory;
  title: string;
  content: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  pinned?: boolean;
  locked?: boolean;
  status?: MemoryStatus;
  expiresAt?: number;
  source: MemorySource;
  allowDuplicate?: boolean;
  operation?: 'create' | 'update' | 'merge' | 'conflict';
  targetId?: string;
}

export interface SaveMemoryResult {
  memory: MemoryRecord;
  created: boolean;
  merged: boolean;
  conflict: boolean;
  skipped?: boolean;
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  category?: MemoryCategory;
  tags?: string[];
  importance?: number;
  confidence?: number;
  pinned?: boolean;
  locked?: boolean;
  status?: MemoryStatus;
  expiresAt?: number | null;
  force?: boolean;
  source: MemorySource;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  projects: number;
}

export interface StoreOptions {
  storagePath: string;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is MemoryStatus {
  return value === 'active' || value === 'archived' || value === 'pending_confirmation' || value === 'conflict' || value === 'expired';
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean).map((tag) => truncate(tag, 32)))].slice(0, 16);
}

function sourceOf(value: unknown): MemorySource {
  if (!value || typeof value !== 'object') return { kind: 'system' };
  const source = value as Record<string, unknown>;
  const kind = source['kind'];
  const allowed = ['auto', 'manual', 'import', 'correction', 'ui', 'system'];
  return {
    kind: allowed.includes(String(kind)) ? (kind as MemorySource['kind']) : 'system',
    ...typeof source['sessionId'] === 'string' ? { sessionId: source['sessionId'] } : {},
    ...typeof source['turn'] === 'number' ? { turn: source['turn'] } : {},
    ...typeof source['seq'] === 'number' ? { seq: source['seq'] } : {},
    ...typeof source['excerpt'] === 'string' ? { excerpt: truncate(source['excerpt'], 500) } : {},
    ...typeof source['note'] === 'string' ? { note: truncate(source['note'], 300) } : {},
  };
}

function validateProjectId(projectId: unknown): string | undefined {
  return typeof projectId === 'string' && /^prj_[a-f0-9]{16}$/.test(projectId) ? projectId : undefined;
}

function statusFromValue(value: unknown, fallback: MemoryStatus): MemoryStatus {
  return isStatus(value) ? value : fallback;
}

/**
 * Durable, in-memory-indexed store over a DSH storage domain.
 *
 * All mutations run through one promise chain. Domain writes are durable before
 * this class publishes the change to its maps and index, so a failed disk write
 * never leaves a visible memory that will vanish on restart.
 */
export class SmartMemoryStore {
  private readonly domain: DomainHandle;
  private readonly options: StoreOptions;
  private readonly memoriesTable: KvTable;
  private readonly projectsTable: KvTable;
  private readonly jobsTable: KvTable;
  private readonly settingsTable: KvTable;
  private readonly auditTable: KvTable;
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly jobs = new Map<string, ExtractionJob>();
  private readonly audit = new Map<string, AuditRecord>();
  private settings: SmartMemorySettings;
  private index = new MemoryIndex();
  private queue: Promise<unknown> = Promise.resolve();
  private _revision = 0;
  private runtimeStatus: StoreRuntimeStatus = { processing: false };
  private workspaceHints: WorkspaceHint[] = [];

  constructor(domain: DomainHandle, options: StoreOptions) {
    this.domain = domain;
    this.options = options;
    this.memoriesTable = domain.table('memories');
    this.projectsTable = domain.table('projects');
    this.jobsTable = domain.table('jobs');
    this.settingsTable = domain.table('settings');
    this.auditTable = domain.table('audit');
    this.settings = { ...DEFAULT_SETTINGS, storagePath: options.storagePath };
  }

  async load(): Promise<void> {
    for (const [key, raw] of this.memoriesTable.entries()) {
      const memory = this.normalizeStoredMemory(raw);
      if (memory) this.memories.set(memory.id || key, memory);
    }
    for (const [key, raw] of this.projectsTable.entries()) {
      const project = this.normalizeStoredProject(raw);
      if (project) this.projects.set(project.id || key, project);
    }
    for (const [key, raw] of this.jobsTable.entries()) {
      const job = this.normalizeStoredJob(raw);
      if (job) this.jobs.set(job.id || key, job);
    }
    for (const [key, raw] of this.auditTable.entries()) {
      const record = this.normalizeStoredAudit(raw);
      if (record) this.audit.set(record.id || key, record);
    }
    const storedSettings = this.settingsTable.get('default');
    if (storedSettings && typeof storedSettings === 'object') {
      this.settings = this.sanitizeSettings(storedSettings as Partial<SmartMemorySettings>);
    }
    this.settings.storagePath = this.options.storagePath;
    this.index.rebuild(this.memories.values());
    // A process that died while a job was running left an unfinished job.
    // Requeue it; the turn payload is already durable.
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        job.status = 'pending';
        job.attempts = Math.min(job.attempts, job.maxAttempts - 1);
        job.nextAttemptAt = now();
        job.updatedAt = now();
        await this.jobsTable.put(job.id, job);
      }
    }
    this.log('info', `loaded ${this.memories.size} memories, ${this.projects.size} projects, ${this.jobs.size} jobs`);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    const logger = this.options.logger;
    const fn = logger?.[level];
    if (typeof fn === 'function') fn.call(logger, `[smart-memory] ${message}`);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  get revision(): number {
    return this._revision;
  }

  get storagePath(): string {
    return this.options.storagePath;
  }

  setWorkspaceHints(hints: WorkspaceHint[]): void {
    this.workspaceHints = hints;
  }

  getWorkspaceHints(): WorkspaceHint[] {
    return this.workspaceHints;
  }

  getSettings(): SmartMemorySettings {
    return clone(this.settings);
  }

  async updateSettings(patch: Partial<SmartMemorySettings>): Promise<SmartMemorySettings> {
    return this.withLock(async () => {
      const next = this.sanitizeSettings({ ...this.settings, ...patch });
      next.storagePath = this.options.storagePath;
      await this.settingsTable.put('default', next);
      this.settings = next;
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: 'ui',
        action: 'settings.update',
        detail: JSON.stringify(patch).slice(0, 1000),
        ok: true,
      });
      return clone(next);
    });
  }

  private sanitizeSettings(raw: Partial<SmartMemorySettings>): SmartMemorySettings {
    const conflict = raw.conflictPolicy;
    return {
      autoGlobal: asBoolean(raw.autoGlobal, DEFAULT_SETTINGS.autoGlobal),
      autoProject: asBoolean(raw.autoProject, DEFAULT_SETTINGS.autoProject),
      autoSummarize: asBoolean(raw.autoSummarize, DEFAULT_SETTINGS.autoSummarize),
      autoRecall: asBoolean(raw.autoRecall, DEFAULT_SETTINGS.autoRecall),
      conflictPolicy:
        conflict === 'merge' || conflict === 'prefer_new' || conflict === 'keep_both' || conflict === 'ask'
          ? conflict
          : DEFAULT_SETTINGS.conflictPolicy,
      retrievalLimit: Math.round(clamp(asNumber(raw.retrievalLimit, DEFAULT_SETTINGS.retrievalLimit), 1, 30)),
      contextTokenBudget: Math.round(clamp(asNumber(raw.contextTokenBudget, DEFAULT_SETTINGS.contextTokenBudget), 200, 8000)),
      sensitiveFilter: asBoolean(raw.sensitiveFilter, DEFAULT_SETTINGS.sensitiveFilter),
      autoArchiveDays: Math.round(clamp(asNumber(raw.autoArchiveDays, DEFAULT_SETTINGS.autoArchiveDays), 0, 3650)),
      ignorePaths: Array.isArray(raw.ignorePaths)
        ? [...new Set(raw.ignorePaths.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 50)
        : [...DEFAULT_SETTINGS.ignorePaths],
      storagePath: this.options.storagePath,
    };
  }

  private bumpRevision(): void {
    this._revision += 1;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  getProject(id: string | undefined): ProjectRecord | undefined {
    return id ? this.projects.get(id) : undefined;
  }

  listProjects(): ProjectSummary[] {
    const counts = new Map<string, { count: number; active: number; last?: number }>();
    for (const memory of this.memories.values()) {
      if (memory.scope !== 'project' || !memory.projectId) continue;
      const entry = counts.get(memory.projectId) ?? { count: 0, active: 0 };
      entry.count += 1;
      if (memory.status === 'active' || memory.status === 'pending_confirmation' || memory.status === 'conflict') entry.active += 1;
      entry.last = Math.max(entry.last ?? 0, memory.updatedAt);
      counts.set(memory.projectId, entry);
    }
    return [...this.projects.values()]
      .map((project) => {
        const count = counts.get(project.id);
        return {
          ...clone(project),
          memoryCount: count?.count ?? 0,
          activeCount: count?.active ?? 0,
          ...count?.last === undefined ? {} : { lastMemoryAt: count.last },
        };
      })
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.name.localeCompare(b.name));
  }

  findProjectByPath(cwd: string | undefined): ProjectRecord | undefined {
    const candidate = detectProject(cwd, [...this.projects.values()], this.workspaceHints);
    return candidate ? this.projects.get(candidate.id) : undefined;
  }

  resolveProjectCandidate(cwd: string | undefined): ProjectCandidate | null {
    return detectProject(cwd, [...this.projects.values()], this.workspaceHints);
  }

  async ensureProject(candidate: ProjectCandidate, sessionId?: string): Promise<ProjectRecord> {
    return this.withLock(async () => {
      const existing = this.projects.get(candidate.id);
      const timestamp = now();
      if (existing) {
        let changed = false;
        const next: ProjectRecord = { ...existing };
        if (sessionId && !next.sessionIds.includes(sessionId)) {
          next.sessionIds = [...next.sessionIds, sessionId].slice(-200);
          changed = true;
        }
        if (next.name !== candidate.name && !next.name) {
          next.name = candidate.name;
          changed = true;
        }
        if (candidate.gitRoot && next.gitRoot !== candidate.gitRoot) {
          next.gitRoot = candidate.gitRoot;
          changed = true;
        }
        if (candidate.markers.length > 0 && next.markers.length === 0) {
          next.markers = candidate.markers;
          changed = true;
        }
        if (timestamp - next.lastActiveAt > 60_000 || changed) {
          next.lastActiveAt = timestamp;
          next.updatedAt = timestamp;
          changed = true;
        }
        if (changed) {
          await this.projectsTable.put(next.id, next);
          this.projects.set(next.id, next);
        }
        return clone(next);
      }
      const project: ProjectRecord = {
        id: candidate.id,
        name: candidate.name || '未命名项目',
        rootPath: candidate.rootPath,
        canonicalKey: candidate.canonicalKey,
        ...candidate.gitRoot === undefined ? {} : { gitRoot: candidate.gitRoot },
        markers: candidate.markers,
        aliases: [],
        sessionIds: sessionId ? [sessionId] : [],
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActiveAt: timestamp,
        pinned: false,
        archived: false,
      };
      await this.projectsTable.put(project.id, project);
      this.projects.set(project.id, project);
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: 'system',
        action: 'project.create',
        scope: 'project',
        projectId: project.id,
        detail: project.rootPath,
        ok: true,
      });
      return clone(project);
    });
  }

  async renameProject(id: string, name: string): Promise<ProjectRecord> {
    return this.withLock(async () => {
      const project = this.projects.get(id);
      if (!project) throw new Error(`项目不存在：${id}`);
      const title = name.trim().slice(0, 120);
      if (!title) throw new Error('项目名称不能为空');
      const next: ProjectRecord = { ...project, name: title, updatedAt: now() };
      await this.projectsTable.put(id, next);
      this.projects.set(id, next);
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: 'ui',
        action: 'project.rename',
        scope: 'project',
        projectId: id,
        detail: title,
        ok: true,
      });
      return clone(next);
    });
  }

  // -------------------------------------------------------------------------
  // Memories
  // -------------------------------------------------------------------------

  getMemory(id: string): MemoryRecord | undefined {
    const memory = this.memories.get(id);
    return memory ? clone(memory) : undefined;
  }

  allMemories(): MemoryRecord[] {
    return [...this.memories.values()].map((memory) => clone(memory));
  }

  search(options: SearchOptions): RankedMemory[] {
    return this.index.search(options, new Map([...this.projects.values()].map((project) => [project.id, project.name])));
  }

  /** Index-backed recall selection for the dynamic system-prompt section. */
  recall(query: string, projectId: string | undefined, projectName?: string): MemoryRecord[] {
    return selectRecallMemories(this.index, query, projectId, this.settings, projectName);
  }

  listMemories(options: SearchOptions = {}): { total: number; memories: MemoryRecord[] } {
    const ranked = this.index.search({ ...options, limit: options.limit ?? 100, offset: options.offset ?? 0 });
    const filteredTotal = this.index.search({ ...options, limit: 10_000, offset: 0 }).length;
    return { total: filteredTotal, memories: ranked.map((entry) => clone(entry.memory)) };
  }

  async saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult> {
    return this.withLock(() => this.saveMemoryUnlocked(input));
  }

  private prepareMemoryInput(input: SaveMemoryInput): {
    scope: MemoryScope;
    projectId?: string;
    category: MemoryCategory;
    title: string;
    content: string;
    tags: string[];
    importance: number;
    confidence: number;
    pinned: boolean;
    locked: boolean;
    status: MemoryStatus;
    expiresAt?: number;
    source: MemorySource;
  } {
    if (input.scope !== 'global' && input.scope !== 'project') throw new Error('scope 必须是 global 或 project');
    const scope = input.scope;
    const projectId = scope === 'project' ? validateProjectId(input.projectId) : undefined;
    if (scope === 'project' && !projectId) throw new Error('项目记忆必须提供有效的 projectId');
    if (scope === 'project' && !this.projects.has(projectId!)) throw new Error(`项目不存在：${projectId}`);
    const title = truncate((input.title ?? '').trim(), 200);
    let content = truncate((input.content ?? '').trim(), 8000);
    if (!title) throw new Error('记忆标题不能为空');
    if (!content) throw new Error('记忆内容不能为空');
    if (this.settings.sensitiveFilter) {
      content = redactSensitive(content);
      if (!content.trim()) throw new Error('内容在敏感信息过滤后为空，未保存');
    }
    const safeTitle = this.settings.sensitiveFilter ? redactSensitive(title) : title;
    const category = isCategory(input.category) ? input.category : 'other';
    return {
      scope,
      ...projectId === undefined ? {} : { projectId },
      category,
      title: safeTitle,
      content,
      tags: normalizeTags(input.tags),
      importance: Math.round(clamp(asNumber(input.importance, 3), 1, 5)),
      confidence: clamp(asNumber(input.confidence, 0.8), 0, 1),
      pinned: input.pinned === true,
      locked: input.locked === true,
      status: statusFromValue(input.status, 'active'),
      ...input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt },
      source: sourceOf(input.source),
    };
  }

  private async saveMemoryUnlocked(input: SaveMemoryInput): Promise<SaveMemoryResult> {
    const prepared = this.prepareMemoryInput(input);
    const target = input.targetId ? this.memories.get(input.targetId) : undefined;
    if (target && target.scope !== prepared.scope) {
      throw new Error('目标记忆的归属范围与本次保存不一致');
    }
    if (target && prepared.scope === 'project' && target.projectId !== prepared.projectId) {
      throw new Error('目标记忆属于其他项目，不能跨项目更新');
    }
    if (target && !input.allowDuplicate) {
      if (target.locked) {
        if (prepared.source.kind === 'auto') {
          await this.appendAuditUnlocked({
            actor: 'auto',
            action: 'memory.skip_locked',
            memoryId: target.id,
            scope: target.scope,
            projectId: target.projectId,
            ok: true,
          });
          return { memory: clone(target), created: false, merged: false, conflict: false, skipped: true };
        }
        throw new Error(`记忆 ${target.id} 已锁定，不能自动修改；请先解锁`);
      }
      const operation = input.operation ?? 'merge';
      if (operation === 'conflict') {
        return this.createConflict(target, prepared, input);
      }
      if (operation === 'update' || operation === 'merge' || operation === 'create') {
        return this.mergeInto(target, prepared, input, operation === 'create');
      }
    }

    const similar = input.allowDuplicate
      ? undefined
      : this.index.findSimilar(
          {
            scope: prepared.scope,
            projectId: prepared.projectId,
            category: prepared.category,
            title: prepared.title,
            content: prepared.content,
          },
          input.source.kind === 'auto' ? 0.7 : 0.82,
        );
    if (similar && !input.allowDuplicate) {
      if (similar.locked) {
        if (prepared.source.kind === 'auto') {
          return { memory: clone(similar), created: false, merged: false, conflict: false, skipped: true };
        }
        throw new Error(`记忆 ${similar.id} 已锁定，不能自动合并；请先解锁`);
      }
      if (input.operation === 'conflict') return this.createConflict(similar, prepared, input);
      return this.mergeInto(similar, prepared, input, false);
    }
    return this.createMemory(prepared, input);
  }

  private async createMemory(
    prepared: ReturnType<SmartMemoryStore['prepareMemoryInput']>,
    input: SaveMemoryInput,
    conflictWith: string[] = [],
  ): Promise<SaveMemoryResult> {
    const timestamp = now();
    const memory: MemoryRecord = {
      id: newId('mem'),
      scope: prepared.scope,
      ...prepared.projectId === undefined ? {} : { projectId: prepared.projectId },
      category: prepared.category,
      title: prepared.title,
      content: prepared.content,
      tags: prepared.tags,
      importance: prepared.importance,
      confidence: prepared.confidence,
      status: conflictWith.length > 0 ? 'pending_confirmation' : prepared.status,
      pinned: prepared.pinned,
      locked: prepared.locked,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
      ...prepared.expiresAt === undefined ? {} : { expiresAt: prepared.expiresAt },
      source: prepared.source,
      conflictWith,
      versions: [],
      normalizedTitle: normalizedTitle(prepared.title),
      revision: this._revision + 1,
    };
    await this.memoriesTable.put(memory.id, memory);
    this.memories.set(memory.id, memory);
    this.index.upsert(memory);
    this.bumpRevision();
    memory.revision = this._revision;
    await this.memoriesTable.put(memory.id, memory);
    await this.appendAuditUnlocked({
      actor: prepared.source.kind === 'auto' ? 'auto' : prepared.source.kind === 'import' ? 'import' : prepared.source.kind === 'ui' ? 'ui' : 'tool',
      action: 'memory.create',
      memoryId: memory.id,
      scope: memory.scope,
      projectId: memory.projectId,
      sessionId: prepared.source.sessionId,
      detail: memory.title,
      ok: true,
    });
    return { memory: clone(memory), created: true, merged: false, conflict: conflictWith.length > 0 };
  }

  private async mergeInto(
    target: MemoryRecord,
    prepared: ReturnType<SmartMemoryStore['prepareMemoryInput']>,
    input: SaveMemoryInput,
    forceCreate: boolean,
  ): Promise<SaveMemoryResult> {
    // An explicit `update` from the summarizer means "replace the old fact",
    // not "append both". The deployment's merge policy applies to heuristic
    // similarity and explicit `merge` operations.
    const policy = input.operation === 'update' ? 'prefer_new' : this.settings.conflictPolicy;
    if (forceCreate && input.operation === 'create') {
      return this.createMemory(prepared, input);
    }
    const sameContent = normalizeText(target.content) === normalizeText(prepared.content);
    if (sameContent && normalizeText(target.title) === normalizeText(prepared.title)) {
      const next: MemoryRecord = {
        ...target,
        importance: Math.max(target.importance, prepared.importance),
        confidence: Math.max(target.confidence, prepared.confidence),
        tags: normalizeTags([...target.tags, ...prepared.tags]),
        updatedAt: now(),
        lastAccessedAt: now(),
        source: prepared.source,
        revision: this._revision + 1,
      };
      await this.persistUpdate(target, next, 'memory.touch', prepared.source);
      return { memory: clone(next), created: false, merged: true, conflict: false };
    }
    if (policy === 'keep_both' || policy === 'ask') {
      return this.createConflict(target, prepared, input);
    }
    const timestamp = now();
    const next: MemoryRecord = {
      ...target,
      title: policy === 'prefer_new' ? prepared.title : target.title,
      content: policy === 'prefer_new' ? prepared.content : this.mergeContent(target.content, prepared.content),
      category: prepared.category,
      tags: normalizeTags([...target.tags, ...prepared.tags]),
      importance: Math.max(target.importance, prepared.importance),
      confidence: Math.max(target.confidence, prepared.confidence),
      pinned: target.pinned || prepared.pinned,
      updatedAt: timestamp,
      lastAccessedAt: timestamp,
      source: prepared.source,
      versions: this.versionHistory(target, 'memory.merge', prepared.source),
      normalizedTitle: normalizedTitle(policy === 'prefer_new' ? prepared.title : target.title),
      revision: this._revision + 1,
    };
    await this.persistUpdate(target, next, 'memory.merge', prepared.source);
    return { memory: clone(next), created: false, merged: true, conflict: false };
  }

  private mergeContent(existing: string, incoming: string): string {
    if (normalizeText(existing).includes(normalizeText(incoming))) return existing;
    if (normalizeText(incoming).includes(normalizeText(existing))) return incoming;
    return `${existing}\n\n补充：${incoming}`.slice(0, 8000);
  }

  private async createConflict(
    target: MemoryRecord,
    prepared: ReturnType<SmartMemoryStore['prepareMemoryInput']>,
    input: SaveMemoryInput,
  ): Promise<SaveMemoryResult> {
    const result = await this.createMemory(prepared, { ...input, operation: 'create' }, [target.id]);
    const conflictTarget: MemoryRecord = {
      ...target,
      status: 'conflict',
      conflictWith: [...new Set([...target.conflictWith, result.memory.id])],
      updatedAt: now(),
      revision: this._revision + 1,
    };
    await this.persistUpdate(target, conflictTarget, 'memory.conflict', prepared.source);
    await this.appendAuditUnlocked({
      actor: prepared.source.kind === 'auto' ? 'auto' : 'tool',
      action: 'memory.conflict',
      memoryId: target.id,
      scope: target.scope,
      projectId: target.projectId,
      detail: `与新记忆 ${result.memory.id} 冲突，等待确认`,
      ok: true,
    });
    return { memory: result.memory, created: true, merged: false, conflict: true };
  }

  private versionHistory(memory: MemoryRecord, action: string, source: MemorySource) {
    return [
      ...memory.versions,
      {
        at: memory.updatedAt,
        action,
        title: memory.title,
        content: memory.content,
        importance: memory.importance,
        source: memory.source,
      },
    ].slice(-10);
  }

  private async persistUpdate(
    previous: MemoryRecord,
    next: MemoryRecord,
    action: string,
    source: MemorySource,
  ): Promise<void> {
    await this.memoriesTable.put(next.id, next);
    this.memories.set(next.id, next);
    this.index.upsert(next);
    this.bumpRevision();
    next.revision = this._revision;
    await this.memoriesTable.put(next.id, next);
    await this.appendAuditUnlocked({
      actor: source.kind === 'auto' ? 'auto' : source.kind === 'ui' ? 'ui' : source.kind === 'import' ? 'import' : 'tool',
      action,
      memoryId: next.id,
      scope: next.scope,
      projectId: next.projectId,
      sessionId: source.sessionId,
      detail: `${previous.title} → ${next.title}`.slice(0, 500),
      ok: true,
    });
  }

  async updateMemory(id: string, patch: UpdateMemoryInput): Promise<MemoryRecord> {
    return this.withLock(async () => {
      const current = this.memories.get(id);
      if (!current) throw new Error(`记忆不存在：${id}`);
      if (current.locked && patch.force !== true) throw new Error('该记忆已锁定，请先解锁或显式 force');
      if (patch.title !== undefined && !patch.title.trim()) throw new Error('标题不能为空');
      if (patch.content !== undefined && !patch.content.trim()) throw new Error('内容不能为空');
      let content = patch.content === undefined ? current.content : truncate(patch.content.trim(), 8000);
      if (this.settings.sensitiveFilter) content = redactSensitive(content);
      const rawTitle = patch.title === undefined ? current.title : truncate(patch.title.trim(), 200);
      const title = this.settings.sensitiveFilter ? redactSensitive(rawTitle) : rawTitle;
      const next: MemoryRecord = {
        ...current,
        title,
        content,
        category: isCategory(patch.category) ? patch.category : current.category,
        tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags),
        importance: patch.importance === undefined ? current.importance : Math.round(clamp(patch.importance, 1, 5)),
        confidence: patch.confidence === undefined ? current.confidence : clamp(patch.confidence, 0, 1),
        pinned: patch.pinned === undefined ? current.pinned : patch.pinned,
        locked: patch.locked === undefined ? current.locked : patch.locked,
        status: statusFromValue(patch.status, current.status),
        updatedAt: now(),
        lastAccessedAt: now(),
        ...patch.expiresAt === null ? { expiresAt: undefined } : patch.expiresAt === undefined ? {} : { expiresAt: patch.expiresAt },
        source: patch.source,
        versions: this.versionHistory(current, 'memory.update', patch.source),
        normalizedTitle: normalizedTitle(title),
        revision: this._revision + 1,
      };
      if (next.expiresAt === undefined) delete next.expiresAt;
      await this.persistUpdate(current, next, 'memory.update', patch.source);
      return clone(next);
    });
  }

  async setPinned(id: string, pinned: boolean): Promise<MemoryRecord> {
    return this.withLock(async () => {
      const current = this.memories.get(id);
      if (!current) throw new Error(`记忆不存在：${id}`);
      if (current.pinned === pinned) return clone(current);
      const next: MemoryRecord = {
        ...current,
        pinned,
        updatedAt: now(),
        versions: this.versionHistory(current, pinned ? 'memory.pin' : 'memory.unpin', { kind: 'ui' }),
        revision: this._revision + 1,
      };
      await this.persistUpdate(current, next, pinned ? 'memory.pin' : 'memory.unpin', { kind: 'ui' });
      return clone(next);
    });
  }

  async setLocked(id: string, locked: boolean): Promise<MemoryRecord> {
    return this.withLock(async () => {
      const current = this.memories.get(id);
      if (!current) throw new Error(`记忆不存在：${id}`);
      if (current.locked === locked) return clone(current);
      const next: MemoryRecord = {
        ...current,
        locked,
        updatedAt: now(),
        versions: this.versionHistory(current, locked ? 'memory.lock' : 'memory.unlock', { kind: 'ui' }),
        revision: this._revision + 1,
      };
      await this.persistUpdate(current, next, locked ? 'memory.lock' : 'memory.unlock', { kind: 'ui' });
      return clone(next);
    });
  }

  async deleteMemory(id: string, source: MemorySource = { kind: 'ui' }): Promise<boolean> {
    return this.withLock(async () => {
      const current = this.memories.get(id);
      if (!current) return false;
      await this.memoriesTable.delete(id);
      this.memories.delete(id);
      this.index.remove(id);
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: source.kind === 'auto' ? 'auto' : source.kind === 'ui' ? 'ui' : 'tool',
        action: 'memory.delete',
        memoryId: id,
        scope: current.scope,
        projectId: current.projectId,
        sessionId: source.sessionId,
        detail: current.title,
        ok: true,
      });
      return true;
    });
  }

  async deleteMany(ids: string[], source: MemorySource = { kind: 'ui' }): Promise<number> {
    return this.withLock(async () => {
      const present = [...new Set(ids)].filter((id) => this.memories.has(id));
      if (present.length === 0) return 0;
      await this.memoriesTable.deleteMany(present);
      for (const id of present) {
        this.memories.delete(id);
        this.index.remove(id);
      }
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: source.kind === 'ui' ? 'ui' : 'tool',
        action: 'memory.delete_many',
        scope: 'all',
        detail: `deleted ${present.length} memories`,
        ok: true,
      });
      return present.length;
    });
  }

  async clearProject(projectId: string, source: MemorySource = { kind: 'ui' }): Promise<number> {
    return this.withLock(async () => {
      const ids = [...this.memories.values()]
        .filter((memory) => memory.scope === 'project' && memory.projectId === projectId)
        .map((memory) => memory.id);
      if (ids.length === 0) return 0;
      await this.memoriesTable.deleteMany(ids);
      for (const id of ids) {
        this.memories.delete(id);
        this.index.remove(id);
      }
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: source.kind === 'ui' ? 'ui' : 'tool',
        action: 'memory.clear_project',
        scope: 'project',
        projectId,
        detail: `deleted ${ids.length} memories`,
        ok: true,
      });
      return ids.length;
    });
  }

  async forgetScope(scope: 'global' | 'project' | 'all', projectId?: string, source: MemorySource = { kind: 'ui' }): Promise<number> {
    return this.withLock(async () => {
      const ids = [...this.memories.values()]
        .filter((memory) => {
          if (scope === 'global') return memory.scope === 'global';
          if (scope === 'project') return memory.scope === 'project' && (!projectId || memory.projectId === projectId);
          return true;
        })
        .map((memory) => memory.id);
      if (ids.length === 0) return 0;
      await this.memoriesTable.deleteMany(ids);
      for (const id of ids) {
        this.memories.delete(id);
        this.index.remove(id);
      }
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: source.kind === 'ui' ? 'ui' : 'tool',
        action: 'memory.forget',
        scope,
        projectId,
        detail: `deleted ${ids.length} memories`,
        ok: true,
      });
      return ids.length;
    });
  }

  async archiveOld(): Promise<number> {
    return this.withLock(async () => {
      const days = this.settings.autoArchiveDays;
      if (days <= 0) return 0;
      const cutoff = now() - days * 86_400_000;
      let archived = 0;
      for (const memory of [...this.memories.values()]) {
        if (archived >= 100) break;
        const expired = memory.expiresAt !== undefined && memory.expiresAt <= now();
        const stale = memory.status === 'active' && memory.importance <= 2 && !memory.pinned && !memory.locked && memory.updatedAt < cutoff;
        if (!expired && !stale) continue;
        const next: MemoryRecord = {
          ...memory,
          status: expired ? 'expired' : 'archived',
          updatedAt: now(),
          versions: this.versionHistory(memory, expired ? 'memory.expire' : 'memory.archive', { kind: 'system' }),
          revision: this._revision + 1,
        };
        await this.memoriesTable.put(next.id, next);
        this.memories.set(next.id, next);
        this.index.upsert(next);
        this.bumpRevision();
        archived += 1;
      }
      if (archived > 0) {
        await this.appendAuditUnlocked({
          actor: 'system',
          action: 'memory.archive',
          detail: `archived/expired ${archived} memories`,
          ok: true,
        });
      }
      return archived;
    });
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  getJob(id: string): ExtractionJob | undefined {
    const job = this.jobs.get(id);
    return job ? clone(job) : undefined;
  }

  listJobs(limit = 50): ExtractionJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((job) => clone(job));
  }

  queueDepth(): number {
    return [...this.jobs.values()].filter((job) => job.status === 'pending' || job.status === 'running').length;
  }

  async enqueueJob(job: Omit<ExtractionJob, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'attempts' | 'maxAttempts' | 'nextAttemptAt'> & {
    maxAttempts?: number;
  }): Promise<ExtractionJob | undefined> {
    return this.withLock(async () => {
      const dedupeKey = `${job.sessionId}:${job.turn}`;
      const existing = [...this.jobs.values()].find((candidate) => `${candidate.sessionId}:${candidate.turn}` === dedupeKey);
      if (existing) return clone(existing);
      const timestamp = now();
      const record: ExtractionJob = {
        id: newId('job'),
        sessionId: job.sessionId,
        turn: job.turn,
        ...job.projectId === undefined ? {} : { projectId: job.projectId },
        ...job.cwd === undefined ? {} : { cwd: job.cwd },
        status: 'pending',
        attempts: 0,
        maxAttempts: job.maxAttempts ?? 3,
        nextAttemptAt: timestamp + 1200,
        createdAt: timestamp,
        updatedAt: timestamp,
        input: job.input,
      };
      await this.jobsTable.put(record.id, record);
      this.jobs.set(record.id, record);
      this.bumpRevision();
      return clone(record);
    });
  }

  dueJobs(limit = 3): ExtractionJob[] {
    const timestamp = now();
    return [...this.jobs.values()]
      .filter((job) => job.status === 'pending' && job.nextAttemptAt <= timestamp)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)
      .slice(0, Math.max(1, limit))
      .map((job) => clone(job));
  }

  async markJobRunning(id: string): Promise<ExtractionJob | undefined> {
    return this.withLock(async () => {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'pending') return undefined;
      const next: ExtractionJob = { ...job, status: 'running', attempts: job.attempts + 1, updatedAt: now() };
      await this.jobsTable.put(id, next);
      this.jobs.set(id, next);
      return clone(next);
    });
  }

  async markJobDone(id: string, result: NonNullable<ExtractionJob['result']>, mode: 'llm' | 'heuristic'): Promise<void> {
    return this.withLock(async () => {
      const job = this.jobs.get(id);
      if (!job) return;
      const next: ExtractionJob = { ...job, status: 'done', result, mode, updatedAt: now(), lastError: undefined };
      await this.jobsTable.put(id, next);
      this.jobs.set(id, next);
      this.bumpRevision();
    });
  }

  async markJobFailed(id: string, error: string, retry: boolean): Promise<void> {
    return this.withLock(async () => {
      const job = this.jobs.get(id);
      if (!job) return;
      const canRetry = retry && job.attempts < job.maxAttempts;
      const next: ExtractionJob = {
        ...job,
        status: canRetry ? 'pending' : 'failed',
        nextAttemptAt: canRetry ? now() + Math.min(300_000, 5000 * 2 ** job.attempts) : job.nextAttemptAt,
        lastError: truncate(error, 1000),
        updatedAt: now(),
      };
      await this.jobsTable.put(id, next);
      this.jobs.set(id, next);
      this.bumpRevision();
    });
  }

  async cleanupJobs(): Promise<number> {
    return this.withLock(async () => {
      const cutoff = now() - 7 * 86_400_000;
      const ids = [...this.jobs.values()]
        .filter((job) => (job.status === 'done' || job.status === 'failed') && job.updatedAt < cutoff)
        .map((job) => job.id);
      if (ids.length === 0) return 0;
      await this.jobsTable.deleteMany(ids);
      for (const id of ids) this.jobs.delete(id);
      return ids.length;
    });
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  private normalizeStoredAudit(raw: unknown): AuditRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = asString(record['id']);
    if (!id) return null;
    return {
      id,
      at: asNumber(record['at'], now()),
      actor: (['tool', 'ui', 'auto', 'system', 'import'].includes(String(record['actor'])) ? record['actor'] : 'system') as AuditRecord['actor'],
      action: asString(record['action'], 'unknown'),
      ...typeof record['memoryId'] === 'string' ? { memoryId: record['memoryId'] } : {},
      ...typeof record['scope'] === 'string' ? { scope: record['scope'] as AuditRecord['scope'] } : {},
      ...typeof record['projectId'] === 'string' ? { projectId: record['projectId'] } : {},
      ...typeof record['sessionId'] === 'string' ? { sessionId: record['sessionId'] } : {},
      ...typeof record['detail'] === 'string' ? { detail: record['detail'] } : {},
      ok: record['ok'] !== false,
    };
  }

  private async appendAuditUnlocked(entry: Omit<AuditRecord, 'id' | 'at'> & { at?: number }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: newId('aud'),
      at: entry.at ?? now(),
      actor: entry.actor,
      action: entry.action,
      ...entry.memoryId === undefined ? {} : { memoryId: entry.memoryId },
      ...entry.scope === undefined ? {} : { scope: entry.scope },
      ...entry.projectId === undefined ? {} : { projectId: entry.projectId },
      ...entry.sessionId === undefined ? {} : { sessionId: entry.sessionId },
      ...entry.detail === undefined ? {} : { detail: truncate(entry.detail, 1000) },
      ok: entry.ok,
    };
    await this.auditTable.put(record.id, record);
    this.audit.set(record.id, record);
    if (this.audit.size > 1000) {
      const oldest = [...this.audit.values()].sort((a, b) => a.at - b.at).slice(0, this.audit.size - 1000);
      const ids = oldest.map((item) => item.id);
      if (ids.length > 0) {
        await this.auditTable.deleteMany(ids);
        for (const id of ids) this.audit.delete(id);
      }
    }
    return record;
  }

  async appendAudit(entry: Omit<AuditRecord, 'id' | 'at'>): Promise<AuditRecord> {
    return this.withLock(() => this.appendAuditUnlocked(entry));
  }

  listAudit(limit = 50): AuditRecord[] {
    return [...this.audit.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((record) => clone(record));
  }

  // -------------------------------------------------------------------------
  // Stats, export, import
  // -------------------------------------------------------------------------

  stats(): MemoryStats {
    let global = 0;
    let project = 0;
    let active = 0;
    let archived = 0;
    let pending = 0;
    let pinned = 0;
    for (const memory of this.memories.values()) {
      if (memory.scope === 'global') global += 1;
      else project += 1;
      if (memory.status === 'active') active += 1;
      if (memory.status === 'archived' || memory.status === 'expired') archived += 1;
      if (memory.status === 'pending_confirmation' || memory.status === 'conflict') pending += 1;
      if (memory.pinned) pinned += 1;
    }
    const done = [...this.jobs.values()].filter((job) => job.status === 'done' || job.status === 'failed').length;
    return {
      total: this.memories.size,
      global,
      project,
      active,
      archived,
      pending,
      pinned,
      projects: this.projects.size,
      queueDepth: this.queueDepth(),
      storageBytes: directorySize(this.options.storagePath),
      ...this.runtimeStatus.lastExtractionAt === undefined ? {} : { lastExtractionAt: this.runtimeStatus.lastExtractionAt },
      ...this.runtimeStatus.lastExtractionError === undefined ? {} : { lastExtractionError: this.runtimeStatus.lastExtractionError },
      processedJobs: done,
      revision: this._revision,
    };
  }

  setRuntimeStatus(patch: Partial<StoreRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
  }

  getRuntimeStatus(): StoreRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  overview(): OverviewData {
    const stats = this.stats();
    const recent = [...this.memories.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .map((memory) => clone(memory));
    const lastUpdatedAt = [...this.memories.values()].reduce((max, memory) => Math.max(max, memory.updatedAt), 0) || undefined;
    return {
      ...stats,
      recent,
      ...lastUpdatedAt === undefined ? {} : { lastUpdatedAt },
      settings: this.getSettings(),
      autoStatus: {
        enabled: this.settings.autoGlobal || this.settings.autoProject,
        running: this.runtimeStatus.processing,
        ...this.runtimeStatus.lastExtractionAt === undefined ? {} : { lastRunAt: this.runtimeStatus.lastExtractionAt },
        ...this.runtimeStatus.lastExtractionError === undefined ? {} : { lastError: this.runtimeStatus.lastExtractionError },
        queueDepth: this.queueDepth(),
        ...this.runtimeStatus.lastMode === undefined ? {} : { lastMode: this.runtimeStatus.lastMode },
      },
    };
  }

  exportBundle(scope: 'global' | 'project' | 'all' = 'all', projectId?: string, includeSettings = false): ExportBundle {
    const memories = [...this.memories.values()]
      .filter((memory) => {
        if (scope === 'global') return memory.scope === 'global';
        if (scope === 'project') return memory.scope === 'project' && (!projectId || memory.projectId === projectId);
        return true;
      })
      .map((memory) => clone(memory));
    return {
      format: 'dsh-smart-memory',
      version: 1,
      exportedAt: now(),
      ...includeSettings ? { settings: this.getSettings() } : {},
      memories,
      projects: [...this.projects.values()].map((project) => clone(project)),
    };
  }

  async importBundle(
    bundle: unknown,
    mode: 'merge' | 'replace' = 'merge',
    source: MemorySource = { kind: 'import' },
    replaceIds?: string[],
  ): Promise<ImportResult> {
    return this.withLock(async () => {
      if (!bundle || typeof bundle !== 'object') throw new Error('导入数据必须是对象');
      const data = bundle as Record<string, unknown>;
      if (data['format'] !== 'dsh-smart-memory') throw new Error('不是 DSH Smart Memory 导出文件');
      if (data['version'] !== 1) throw new Error(`不支持的导出格式版本：${String(data['version'])}`);
      const rawMemories = data['memories'];
      if (!Array.isArray(rawMemories)) throw new Error('导出文件缺少 memories 数组');
      if (rawMemories.length > 5000) throw new Error('单次导入最多 5000 条记忆');
      if (mode === 'replace') {
        const ids = (replaceIds ? replaceIds.filter((id) => this.memories.has(id)) : [...this.memories.keys()]);
        if (ids.length > 0) {
          await this.memoriesTable.deleteMany(ids);
          for (const id of ids) {
            this.memories.delete(id);
            this.index.remove(id);
          }
        }
      }
      const rawProjects = Array.isArray(data['projects']) ? data['projects'] : [];
      let projectCount = 0;
      for (const rawProject of rawProjects) {
        const project = this.normalizeImportedProject(rawProject);
        if (!project) continue;
        const existing = this.projects.get(project.id);
        const next = existing ? { ...existing, ...project, createdAt: existing.createdAt } : project;
        await this.projectsTable.put(next.id, next);
        this.projects.set(next.id, next);
        projectCount += 1;
      }
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const raw of rawMemories) {
        const memory = this.normalizeImportedMemory(raw);
        if (!memory) {
          skipped += 1;
          continue;
        }
        if (memory.scope === 'project' && !this.projects.has(memory.projectId!)) {
          // A bundle may contain only memories; create a minimal project record
          // from the id so isolation and UI grouping still work.
          const fallback: ProjectRecord = {
            id: memory.projectId!,
            name: `导入项目 ${memory.projectId!.slice(4, 10)}`,
            rootPath: '',
            canonicalKey: '',
            markers: [],
            aliases: [],
            sessionIds: [],
            createdAt: now(),
            updatedAt: now(),
            lastActiveAt: now(),
            pinned: false,
            archived: false,
          };
          await this.projectsTable.put(fallback.id, fallback);
          this.projects.set(fallback.id, fallback);
        }
        const existing = this.memories.get(memory.id);
        if (existing) {
          if (existing.locked) {
            skipped += 1;
            continue;
          }
          const next: MemoryRecord = {
            ...memory,
            createdAt: existing.createdAt,
            updatedAt: now(),
            versions: this.versionHistory(existing, 'memory.import', source),
            revision: this._revision + 1,
          };
          await this.memoriesTable.put(next.id, next);
          this.memories.set(next.id, next);
          this.index.upsert(next);
          updated += 1;
        } else {
          await this.memoriesTable.put(memory.id, memory);
          this.memories.set(memory.id, memory);
          this.index.upsert(memory);
          imported += 1;
        }
      }
      this.bumpRevision();
      await this.appendAuditUnlocked({
        actor: 'import',
        action: 'memory.import',
        detail: `mode=${mode} imported=${imported} updated=${updated} skipped=${skipped}`,
        ok: true,
      });
      return { imported, updated, skipped, projects: projectCount };
    });
  }

  private normalizeStoredMemory(raw: unknown): MemoryRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = asString(record['id']);
    const scope = record['scope'] === 'project' ? 'project' : record['scope'] === 'global' ? 'global' : undefined;
    if (!id || !scope) return null;
    const projectId = scope === 'project' ? validateProjectId(record['projectId']) : undefined;
    if (scope === 'project' && !projectId) return null;
    const createdAt = asNumber(record['createdAt'], now());
    const memory: MemoryRecord = {
      id,
      scope,
      ...projectId === undefined ? {} : { projectId },
      category: isCategory(record['category']) ? record['category'] : 'other',
      title: asString(record['title'], '未命名记忆').slice(0, 200),
      content: asString(record['content']).slice(0, 8000),
      tags: normalizeTags(asStringArray(record['tags'])),
      importance: Math.round(clamp(asNumber(record['importance'], 3), 1, 5)),
      confidence: clamp(asNumber(record['confidence'], 0.8), 0, 1),
      status: statusFromValue(record['status'], 'active'),
      pinned: record['pinned'] === true,
      locked: record['locked'] === true,
      createdAt,
      updatedAt: asNumber(record['updatedAt'], createdAt),
      lastAccessedAt: asNumber(record['lastAccessedAt'], createdAt),
      accessCount: Math.max(0, Math.round(asNumber(record['accessCount'], 0))),
      ...typeof record['expiresAt'] === 'number' ? { expiresAt: record['expiresAt'] } : {},
      source: sourceOf(record['source']),
      conflictWith: asStringArray(record['conflictWith']).filter((value) => value.startsWith('mem_')),
      versions: Array.isArray(record['versions'])
        ? record['versions'].filter((item): item is MemoryVersionLike => Boolean(item) && typeof item === 'object').slice(-10).map((item) => ({
            at: asNumber(item.at, createdAt),
            action: asString(item.action, 'update'),
            title: asString(item.title),
            content: asString(item.content),
            importance: Math.round(clamp(asNumber(item.importance, 3), 1, 5)),
            source: sourceOf(item.source),
          }))
        : [],
      normalizedTitle: asString(record['normalizedTitle'], normalizedTitle(asString(record['title']))),
      revision: asNumber(record['revision'], 0),
    };
    return memory.content ? memory : null;
  }

  private normalizeStoredProject(raw: unknown): ProjectRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = asString(record['id']);
    const rootPath = asString(record['rootPath']);
    if (!id.startsWith('prj_') || !rootPath) return null;
    const timestamp = now();
    return {
      id,
      name: asString(record['name'], '未命名项目').slice(0, 120),
      rootPath,
      canonicalKey: asString(record['canonicalKey'], rootPath.replace(/\\/g, '/').toLowerCase()),
      ...typeof record['gitRoot'] === 'string' ? { gitRoot: record['gitRoot'] } : {},
      markers: asStringArray(record['markers']),
      aliases: asStringArray(record['aliases']),
      sessionIds: asStringArray(record['sessionIds']).slice(-200),
      createdAt: asNumber(record['createdAt'], timestamp),
      updatedAt: asNumber(record['updatedAt'], timestamp),
      lastActiveAt: asNumber(record['lastActiveAt'], timestamp),
      pinned: record['pinned'] === true,
      archived: record['archived'] === true,
    };
  }

  private normalizeStoredJob(raw: unknown): ExtractionJob | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = asString(record['id']);
    const sessionId = asString(record['sessionId']);
    if (!id || !sessionId) return null;
    const status = record['status'];
    const input = record['input'];
    if (!input || typeof input !== 'object') return null;
    return {
      id,
      sessionId,
      turn: Math.max(0, Math.round(asNumber(record['turn'], 0))),
      ...typeof record['projectId'] === 'string' ? { projectId: record['projectId'] } : {},
      ...typeof record['cwd'] === 'string' ? { cwd: record['cwd'] } : {},
      status: status === 'running' || status === 'done' || status === 'failed' ? status : 'pending',
      attempts: Math.max(0, Math.round(asNumber(record['attempts'], 0))),
      maxAttempts: Math.max(1, Math.round(asNumber(record['maxAttempts'], 3))),
      nextAttemptAt: asNumber(record['nextAttemptAt'], now()),
      createdAt: asNumber(record['createdAt'], now()),
      updatedAt: asNumber(record['updatedAt'], now()),
      ...typeof record['lastError'] === 'string' ? { lastError: record['lastError'] } : {},
      ...record['mode'] === 'llm' || record['mode'] === 'heuristic' ? { mode: record['mode'] } : {},
      input: {
        userText: asString((input as Record<string, unknown>)['userText']).slice(0, 20_000),
        assistantText: asString((input as Record<string, unknown>)['assistantText']).slice(0, 20_000),
        excerpt: asString((input as Record<string, unknown>)['excerpt']).slice(0, 20_000),
        ...typeof (input as Record<string, unknown>)['provider'] === 'string' ? { provider: (input as Record<string, unknown>)['provider'] as string } : {},
        ...typeof (input as Record<string, unknown>)['model'] === 'string' ? { model: (input as Record<string, unknown>)['model'] as string } : {},
        ...typeof (input as Record<string, unknown>)['reasoningEffort'] === 'string'
          ? { reasoningEffort: (input as Record<string, unknown>)['reasoningEffort'] as string }
          : {},
      },
      ...record['result'] && typeof record['result'] === 'object'
        ? {
            result: {
              created: Math.max(0, Math.round(asNumber((record['result'] as Record<string, unknown>)['created'], 0))),
              updated: Math.max(0, Math.round(asNumber((record['result'] as Record<string, unknown>)['updated'], 0))),
              conflicts: Math.max(0, Math.round(asNumber((record['result'] as Record<string, unknown>)['conflicts'], 0))),
              skipped: Math.max(0, Math.round(asNumber((record['result'] as Record<string, unknown>)['skipped'], 0))),
            },
          }
        : {},
    };
  }

  private normalizeImportedMemory(raw: unknown): MemoryRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const scope = record['scope'] === 'global' || record['scope'] === 'project' ? record['scope'] : undefined;
    if (!scope) return null;
    const projectId = scope === 'project' ? validateProjectId(record['projectId']) : undefined;
    if (scope === 'project' && !projectId) return null;
    const title = truncate(asString(record['title']).trim(), 200);
    const content = truncate(asString(record['content']).trim(), 8000);
    if (!title || !content) return null;
    const timestamp = now();
    const createdAt = asNumber(record['createdAt'], timestamp);
    const memory: MemoryRecord = {
      id: /^mem_[0-9a-f-]{36}$/i.test(asString(record['id'])) ? asString(record['id']) : newId('mem'),
      scope,
      ...projectId === undefined ? {} : { projectId },
      category: isCategory(record['category']) ? record['category'] : 'other',
      title,
      content,
      tags: normalizeTags(asStringArray(record['tags'])),
      importance: Math.round(clamp(asNumber(record['importance'], 3), 1, 5)),
      confidence: clamp(asNumber(record['confidence'], 0.8), 0, 1),
      status: statusFromValue(record['status'], 'active'),
      pinned: record['pinned'] === true,
      locked: record['locked'] === true,
      createdAt,
      updatedAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: Math.max(0, Math.round(asNumber(record['accessCount'], 0))),
      ...typeof record['expiresAt'] === 'number' ? { expiresAt: record['expiresAt'] } : {},
      source: sourceOf(record['source'] ?? { kind: 'import' }),
      conflictWith: [],
      versions: [],
      normalizedTitle: normalizedTitle(title),
      revision: 0,
    };
    return memory;
  }

  private normalizeImportedProject(raw: unknown): ProjectRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = asString(record['id']);
    if (!/^prj_[a-f0-9]{16}$/.test(id)) return null;
    const timestamp = now();
    return {
      id,
      name: truncate(asString(record['name'], '导入项目'), 120),
      rootPath: asString(record['rootPath']),
      canonicalKey: asString(record['canonicalKey'], asString(record['rootPath']).replace(/\\/g, '/').toLowerCase()),
      ...typeof record['gitRoot'] === 'string' ? { gitRoot: record['gitRoot'] } : {},
      markers: asStringArray(record['markers']),
      aliases: asStringArray(record['aliases']),
      sessionIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
      pinned: false,
      archived: false,
    };
  }

  async close(): Promise<void> {
    await this.domain.close();
  }
}

interface MemoryVersionLike {
  at?: unknown;
  action?: unknown;
  title?: unknown;
  content?: unknown;
  importance?: unknown;
  source?: unknown;
}

export function memoryCategoryLabel(category: MemoryCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function projectPathLabel(project: ProjectRecord): string {
  return project.rootPath || project.name;
}

/** Create the domain spec without importing the storage-domain package. */
export function smartMemoryDomainSpec() {
  const permissive = {
    parse<T>(value: T): T {
      return value;
    },
    safeParse<T>(value: T) {
      return { success: true as const, data: value };
    },
  };
  return {
    name: 'dsh_smart_memory',
    version: 1,
    layout: 'per-record' as const,
    tables: {
      memories: { valueSchema: permissive },
      projects: { valueSchema: permissive },
      jobs: { valueSchema: permissive },
      settings: { valueSchema: permissive },
      audit: { valueSchema: permissive },
    },
  };
}

export function storageDirectory(): string {
  return `${process.env['DSH_HOME'] || ''}`;
}
