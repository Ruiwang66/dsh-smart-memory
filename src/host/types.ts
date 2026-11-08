/**
 * Shared data model for DSH Smart Memory.
 *
 * Everything stored here is plain JSON so it can live in a DSH storage domain,
 * an exported archive, or a test fixture without conversion.
 */

export type MemoryScope = 'global' | 'project';

export type MemoryStatus =
  | 'active'
  | 'archived'
  | 'pending_confirmation'
  | 'conflict'
  | 'expired';

export const MEMORY_CATEGORIES = [
  'profile',
  'background',
  'preference',
  'language',
  'style',
  'skill',
  'tool',
  'interest',
  'requirement',
  'correction',
  'habit',
  'project_overview',
  'tech_stack',
  'progress',
  'completed',
  'in_progress',
  'issue',
  'bug_fix',
  'decision',
  'database',
  'api',
  'deployment',
  'environment',
  'constraint',
  'plan',
  'failed_attempt',
  'other',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type ConflictPolicy = 'merge' | 'prefer_new' | 'keep_both' | 'ask';

export interface MemorySource {
  kind: 'auto' | 'manual' | 'import' | 'correction' | 'ui' | 'system';
  sessionId?: string;
  turn?: number;
  seq?: number;
  excerpt?: string;
  note?: string;
}

export interface MemoryVersion {
  at: number;
  action: string;
  title: string;
  content: string;
  importance: number;
  source: MemorySource;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  projectId?: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  confidence: number;
  status: MemoryStatus;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  expiresAt?: number;
  source: MemorySource;
  conflictWith: string[];
  versions: MemoryVersion[];
  normalizedTitle: string;
  /** Monotonic local revision, useful for cache invalidation and diagnostics. */
  revision: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  canonicalKey: string;
  gitRoot?: string;
  markers: string[];
  aliases: string[];
  sessionIds: string[];
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  pinned: boolean;
  archived: boolean;
}

export interface SmartMemorySettings {
  autoGlobal: boolean;
  autoProject: boolean;
  autoSummarize: boolean;
  autoRecall: boolean;
  conflictPolicy: ConflictPolicy;
  retrievalLimit: number;
  contextTokenBudget: number;
  sensitiveFilter: boolean;
  autoArchiveDays: number;
  ignorePaths: string[];
  /** Informational: the host reports the real storage root. */
  storagePath: string;
}

export interface ExtractionJob {
  id: string;
  sessionId: string;
  turn: number;
  projectId?: string;
  cwd?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  mode?: 'llm' | 'heuristic';
  input: {
    userText: string;
    assistantText: string;
    excerpt: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
  };
  result?: {
    created: number;
    updated: number;
    conflicts: number;
    skipped: number;
  };
}

export interface AuditRecord {
  id: string;
  at: number;
  actor: 'tool' | 'ui' | 'auto' | 'system' | 'import';
  action: string;
  memoryId?: string;
  scope?: MemoryScope | 'all';
  projectId?: string;
  sessionId?: string;
  detail?: string;
  ok: boolean;
}

export interface ExtractedMemory {
  title: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  importance: number;
  confidence: number;
  operation?: 'create' | 'update' | 'merge' | 'conflict';
  targetId?: string;
  reason?: string;
}

export interface ExtractionResult {
  global: ExtractedMemory[];
  project: ExtractedMemory[];
}

export interface SearchOptions {
  query?: string;
  scope?: MemoryScope | 'auto' | 'all';
  projectId?: string;
  category?: MemoryCategory;
  tags?: string[];
  status?: MemoryStatus | 'all';
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface RankedMemory {
  memory: MemoryRecord;
  score: number;
}

export interface MemoryStats {
  total: number;
  global: number;
  project: number;
  active: number;
  archived: number;
  pending: number;
  pinned: number;
  projects: number;
  queueDepth: number;
  storageBytes: number;
  lastExtractionAt?: number;
  lastExtractionError?: string;
  processedJobs: number;
  revision: number;
}

export interface OverviewData extends MemoryStats {
  recent: MemoryRecord[];
  lastUpdatedAt?: number;
  settings: SmartMemorySettings;
  autoStatus: {
    enabled: boolean;
    running: boolean;
    lastRunAt?: number;
    lastError?: string;
    queueDepth: number;
    lastMode?: 'llm' | 'heuristic';
  };
}

export interface ExportBundle {
  format: 'dsh-smart-memory';
  version: 1;
  exportedAt: number;
  settings?: SmartMemorySettings;
  memories: MemoryRecord[];
  projects?: ProjectRecord[];
}

export interface ProjectSummary extends ProjectRecord {
  memoryCount: number;
  activeCount: number;
  lastMemoryAt?: number;
}

export const DEFAULT_SETTINGS: SmartMemorySettings = {
  autoGlobal: true,
  autoProject: true,
  autoSummarize: true,
  autoRecall: true,
  conflictPolicy: 'merge',
  retrievalLimit: 8,
  contextTokenBudget: 1200,
  sensitiveFilter: true,
  autoArchiveDays: 180,
  ignorePaths: ['node_modules', '.git', 'dist', 'build', '.next', 'target', 'vendor', '.venv'],
  storagePath: '',
};

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: '基本情况',
  background: '长期背景',
  preference: '长期偏好',
  language: '语言习惯',
  style: '回答风格',
  skill: '技术水平',
  tool: '工具与环境',
  interest: '兴趣领域',
  requirement: '长期要求',
  correction: '纠正记录',
  habit: '工作习惯',
  project_overview: '项目概况',
  tech_stack: '技术栈',
  progress: '开发进度',
  completed: '已完成',
  in_progress: '进行中',
  issue: '未解决问题',
  bug_fix: 'Bug 修复',
  decision: '技术决策',
  database: '数据库',
  api: 'API 约定',
  deployment: '部署信息',
  environment: '环境配置',
  constraint: '项目约束',
  plan: '后续计划',
  failed_attempt: '失败尝试',
  other: '其他',
};

export const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: '全局记忆',
  project: '项目记忆',
};
