import type {
  MemoryRecord,
  RankedMemory,
  SearchOptions,
  SmartMemorySettings,
} from './types.js';
import { CATEGORY_LABELS } from './types.js';
import { estimateTokens, normalizeText, textSimilarity, tokenize, truncate } from './util.js';

interface Doc {
  memory: MemoryRecord;
  tf: Map<string, number>;
  length: number;
  normalizedTitle: string;
  normalizedContent: string;
  normalizedTags: string;
}

const K1 = 1.2;
const B = 0.75;

function fieldTokens(memory: MemoryRecord): string[] {
  const tokens: string[] = [];
  const title = tokenize(memory.title);
  const tags = tokenize(memory.tags.join(' '));
  const content = tokenize(memory.content);
  const category = tokenize(memory.category.replace(/_/g, ' '));
  // Field weighting is achieved by repetition, which keeps one flat BM25 index.
  for (let i = 0; i < 3; i += 1) tokens.push(...title);
  for (let i = 0; i < 2; i += 1) tokens.push(...tags);
  tokens.push(...content);
  tokens.push(...category);
  return tokens;
}

export class MemoryIndex {
  private docs = new Map<string, Doc>();
  private df = new Map<string, number>();
  private totalLength = 0;

  rebuild(memories: Iterable<MemoryRecord>): void {
    this.docs.clear();
    this.df.clear();
    this.totalLength = 0;
    for (const memory of memories) this.upsert(memory);
  }

  upsert(memory: MemoryRecord): void {
    const existing = this.docs.get(memory.id);
    if (existing) this.remove(memory.id);
    const tokens = fieldTokens(memory);
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) this.df.set(token, (this.df.get(token) ?? 0) + 1);
    this.docs.set(memory.id, {
      memory,
      tf,
      length: tokens.length,
      normalizedTitle: normalizeText(memory.title),
      normalizedContent: normalizeText(memory.content),
      normalizedTags: normalizeText(memory.tags.join(' ')),
    });
    this.totalLength += tokens.length;
  }

  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const token of doc.tf.keys()) {
      const next = (this.df.get(token) ?? 1) - 1;
      if (next <= 0) this.df.delete(token);
      else this.df.set(token, next);
    }
    this.totalLength -= doc.length;
    this.docs.delete(id);
  }

  get size(): number {
    return this.docs.size;
  }

  get(id: string): MemoryRecord | undefined {
    return this.docs.get(id)?.memory;
  }

  all(): MemoryRecord[] {
    return [...this.docs.values()].map((doc) => doc.memory);
  }

  search(options: SearchOptions, projectNames: Map<string, string> = new Map()): RankedMemory[] {
    const query = (options.query ?? '').trim();
    const queryTerms = [...new Set(tokenize(query))];
    const normalizedQuery = normalizeText(query);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const offset = Math.max(0, options.offset ?? 0);
    const scope = options.scope ?? 'auto';
    const includeArchived = options.includeArchived === true || options.status === 'all';
    const results: RankedMemory[] = [];
    const totalDocs = Math.max(1, this.docs.size);
    const avgLength = Math.max(1, this.totalLength / totalDocs);
    const now = Date.now();

    for (const doc of this.docs.values()) {
      const memory = doc.memory;
      if (scope === 'global' && memory.scope !== 'global') continue;
      if (scope === 'project' && memory.scope !== 'project') continue;
      if (scope === 'project' && options.projectId && memory.projectId !== options.projectId) continue;
      if (scope === 'auto') {
        if (memory.scope === 'project' && options.projectId && memory.projectId !== options.projectId) continue;
        if (memory.scope === 'project' && !options.projectId) continue;
      }
      if (options.category && memory.category !== options.category) continue;
      if (options.status && options.status !== 'all' && memory.status !== options.status) continue;
      if (!includeArchived && memory.status === 'archived') continue;
      if (options.tags?.length) {
        const wanted = options.tags.map((tag) => tag.toLowerCase());
        if (!wanted.some((tag) => memory.tags.some((candidate) => candidate.toLowerCase() === tag))) continue;
      }

      let score = 0;
      let lexicalScore = 0;
      if (queryTerms.length > 0) {
        for (const term of queryTerms) {
          const df = this.df.get(term) ?? 0;
          const tf = doc.tf.get(term) ?? 0;
          if (df === 0 || tf === 0) continue;
          const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
          lexicalScore += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLength)));
        }
        if (normalizedQuery.length >= 2) {
          if (doc.normalizedTitle.includes(normalizedQuery)) lexicalScore += 4;
          else if (doc.normalizedContent.includes(normalizedQuery)) lexicalScore += 1.8;
          if (doc.normalizedTags.includes(normalizedQuery)) lexicalScore += 2;
        }
        const tagMatches = options.tags?.filter((tag) =>
          memory.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase()),
        ).length ?? 0;
        lexicalScore += tagMatches * 0.6;
        // A query search must have at least one lexical hit. Importance,
        // recency and pin boosts alone must not surface an unrelated memory.
        if (lexicalScore <= 0) continue;
        score += lexicalScore;
      }

      // Stable, domain-meaningful boosts.
      score += (memory.importance - 3) * 0.22;
      score += memory.pinned ? 0.75 : 0;
      score += memory.confidence * 0.2;
      if (memory.scope === 'global') score += 0.05;
      const ageDays = Math.max(0, (now - memory.updatedAt) / 86_400_000);
      score += 0.18 * Math.exp(-ageDays / 120);
      if (memory.category === 'correction' || memory.category === 'requirement') score += 0.15;
      if (memory.status === 'pending_confirmation' || memory.status === 'conflict') score -= 0.25;

      results.push({ memory, score });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.memory.pinned !== b.memory.pinned) return a.memory.pinned ? -1 : 1;
      if (a.memory.importance !== b.memory.importance) return b.memory.importance - a.memory.importance;
      return b.memory.updatedAt - a.memory.updatedAt;
    });
    return results.slice(offset, offset + limit);
  }

  /** Find an existing record that should be merged rather than duplicated. */
  findSimilar(memory: Pick<MemoryRecord, 'scope' | 'projectId' | 'category' | 'title' | 'content'>, threshold = 0.72): MemoryRecord | undefined {
    let best: { memory: MemoryRecord; score: number } | undefined;
    for (const doc of this.docs.values()) {
      const candidate = doc.memory;
      if (candidate.scope !== memory.scope) continue;
      if (memory.scope === 'project' && candidate.projectId !== memory.projectId) continue;
      if (candidate.status === 'archived' || candidate.status === 'expired') continue;
      const titleScore = textSimilarity(candidate.title, memory.title);
      const contentScore = textSimilarity(candidate.content, memory.content);
      const categoryBonus = candidate.category === memory.category ? 0.08 : 0;
      const score = Math.max(titleScore, (titleScore + contentScore) / 2) + categoryBonus;
      if (score >= threshold && (!best || score > best.score)) best = { memory: candidate, score };
    }
    return best?.memory;
  }
}

export function formatMemoryForPrompt(memory: MemoryRecord, projectName?: string): string {
  const flags: string[] = [];
  if (memory.pinned) flags.push('已固定');
  if (memory.locked) flags.push('已锁定');
  if (memory.status === 'pending_confirmation') flags.push('待确认');
  if (memory.status === 'conflict') flags.push('存在冲突');
  const meta = [CATEGORY_LABELS[memory.category], `重要度 ${memory.importance}`, ...flags].join('，');
  const project = memory.scope === 'project' && projectName ? `（项目：${projectName}）` : '';
  return `- [${memory.id}]${project} ${memory.title}（${meta}）：${truncate(memory.content, 320)}`;
}

/**
 * Compose the dynamic system-prompt section. The caller supplies already
 * filtered and deduplicated memories; this function only budgets and renders.
 */
export function buildRecallPrompt(
  memories: MemoryRecord[],
  settings: SmartMemorySettings,
  projectName?: string,
): string {
  if (memories.length === 0) return '';
  const seen = new Set<string>();
  const globals: MemoryRecord[] = [];
  const projects: MemoryRecord[] = [];
  for (const memory of memories) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    if (memory.scope === 'global') globals.push(memory);
    else projects.push(memory);
  }
  const header =
    '## 长期记忆（DSH Smart Memory 自动召回）\n' +
    '以下内容是跨会话保存的历史事实，只作为背景参考；若与当前用户指令或当前项目事实冲突，以当前指令和最新事实为准。' +
    '不要主动向用户展示记忆 ID，除非用户要求管理记忆。';
  const lines: string[] = [header];
  let used = estimateTokens(header);
  const budget = Math.max(200, settings.contextTokenBudget);
  const addSection = (title: string, entries: MemoryRecord[], maxBudget: number) => {
    if (entries.length === 0) return;
    const sectionTitle = `\n### ${title}`;
    const sectionLines = [sectionTitle];
    let sectionUsed = estimateTokens(sectionTitle);
    for (const memory of entries) {
      const line = formatMemoryForPrompt(memory, projectName);
      const cost = estimateTokens(line);
      if (used + sectionUsed + cost > maxBudget) break;
      sectionLines.push(line);
      sectionUsed += cost;
    }
    if (sectionLines.length > 1) {
      lines.push(...sectionLines);
      used += sectionUsed;
    }
  };
  // Keep a meaningful share of the budget for the current project. Global
  // preferences are important, but a prompt that contains only global memories
  // is not useful when the user is asking about the project.
  const globalBudget = projects.length > 0 ? Math.max(180, Math.floor(budget * 0.55)) : budget;
  addSection('用户全局记忆', globals, globalBudget);
  addSection(projectName ? `当前项目记忆：${projectName}` : '当前项目记忆', projects, budget);
  return lines.join('\n');
}

/** De-duplicate and prioritize the global + project candidate lists for recall. */
export function selectRecallMemories(
  index: MemoryIndex,
  query: string,
  projectId: string | undefined,
  settings: SmartMemorySettings,
  projectName?: string,
): MemoryRecord[] {
  if (!settings.autoRecall) return [];
  const limit = Math.max(1, Math.min(30, settings.retrievalLimit));
  const selected = new Map<string, MemoryRecord>();
  const add = (memory: MemoryRecord | undefined) => {
    if (memory && selected.size < limit) selected.set(memory.id, memory);
  };

  // Reserve slots for the current project when one exists. A full set of global
  // preferences must not crowd out the project facts the user is asking about.
  const projectReserve = projectId ? Math.max(2, Math.floor(limit / 2)) : 0;
  const globalCap = Math.max(1, limit - projectReserve);

  // Global preferences stay present even when the current question is about code.
  const globalImportant = index
    .search({ scope: 'global', limit: Math.min(limit, 8), includeArchived: false })
    .map((entry) => entry.memory)
    .filter((memory) => memory.pinned || memory.importance >= 4 || memory.category === 'requirement' || memory.category === 'correction');
  for (const memory of globalImportant) {
    if (selected.size >= globalCap) break;
    add(memory);
  }

  if (projectId) {
    for (const entry of index.search({ scope: 'project', projectId, query, limit })) add(entry.memory);
  }

  if (query.trim()) {
    for (const entry of index.search({ scope: 'auto', projectId, query, limit })) add(entry.memory);
  }

  // Fill remaining slots with recent high-value global/project memories.
  if (selected.size < limit) {
    for (const entry of index.search({ scope: 'auto', projectId, limit: limit * 2 })) add(entry.memory);
  }

  const ordered = [...selected.values()].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return b.updatedAt - a.updatedAt;
  });
  // Budget is enforced by buildRecallPrompt; keep a few extra candidates so
  // truncated lines do not leave empty budget.
  return ordered.slice(0, limit);
}
