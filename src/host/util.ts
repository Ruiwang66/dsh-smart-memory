import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function now(): number {
  return Date.now();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function shortHash(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

export function truncate(text: string, max: number, suffix = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

/** Normalize text for comparison and exact dedupe keys. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’《》<>]/g, '')
    .trim();
}

export function normalizedTitle(title: string): string {
  return normalizeText(title).slice(0, 200);
}

/**
 * Approximate model tokens without a tokenizer dependency.
 * CJK characters are usually one token each; Latin words average ~0.3 token per
 * character. This intentionally over-estimates rather than under-estimates.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 3.2);
}

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_WORD = /[a-z0-9][a-z0-9_+#.-]{1,}/g;

/**
 * Hybrid tokenizer for Chinese and Latin text.
 * CJK runs contribute unigrams and bigrams; Latin text contributes lowercased
 * words. This gives useful recall for short Chinese queries without a
 * dictionary or a native tokenizer.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(LATIN_WORD)) {
    const word = match[0].replace(/^[.-]+|[.-]+$/g, '');
    if (word.length >= 2) tokens.push(word);
  }
  for (const match of normalized.matchAll(CJK_RUN)) {
    const chars = [...match[0]];
    for (let i = 0; i < chars.length; i += 1) {
      tokens.push(chars[i]!);
      if (i + 1 < chars.length) tokens.push(chars[i]! + chars[i + 1]!);
    }
  }
  return tokens;
}

/** Character n-gram Jaccard similarity, used for heuristic dedupe. */
export function textSimilarity(left: string, right: string): number {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

const SECRET_PATTERNS: Array<[RegExp, string | ((substring: string, ...args: any[]) => string)]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s"',;]{4,}/gi, '$1=[REDACTED]'],
  [/\b\d{17}[\dXx]\b/g, '[REDACTED_ID_NUMBER]'],
  [/\b(?:\d[ -]?){15,19}\b/g, '[REDACTED_CARD_NUMBER]'],
  [/(?:账号|账户|密码|口令|密钥|令牌)\s*[:：=]\s*[^\s，。；;]{4,}/g, (match) => match.replace(/[:：=]\s*.*$/, '=[REDACTED]')],
];

/** Remove common credentials and identity numbers before persistence or model calls. */
export function redactSensitive(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    if (typeof replacement === 'function') result = result.replace(pattern, replacement);
    else result = result.replace(pattern, replacement);
  }
  return result;
}

/** Read text blocks from a DSH message content array without touching tool data. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const item = block as Record<string, unknown>;
    if (item['type'] === 'text' && typeof item['text'] === 'string') parts.push(item['text']);
  }
  return parts.join('\n').trim();
}

/** Parse a JSON object out of an LLM response that may contain code fences or prose. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  throw new Error('model response did not contain a valid JSON object');
}

/** Return the current storage root, independent of the host's current directory. */
export function dshHome(): string {
  return process.env['DSH_HOME'] || path.join(process.env['USERPROFILE'] || process.env['HOME'] || process.cwd(), '.dsh');
}

export function canonicalPathSync(input: string): string {
  let resolved = path.resolve(input);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Missing paths are still useful identities; keep the absolute spelling.
  }
  resolved = path.normalize(resolved);
  if (resolved.length > 1) resolved = resolved.replace(/[\\/]+$/, '');
  return resolved;
}

export function pathKey(input: string): string {
  const canonical = canonicalPathSync(input);
  const slashed = canonical.replace(/\\/g, '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

export function isSubpath(child: string, parent: string): boolean {
  const childKey = pathKey(child);
  const parentKey = pathKey(parent);
  return childKey === parentKey || childKey.startsWith(parentKey.endsWith('/') ? parentKey : `${parentKey}/`);
}

export function relativeDisplayPath(child: string, parent: string): string {
  const rel = path.relative(parent, child);
  return rel || '.';
}

/** Match a path against a simple glob (`*`, `**`) or a plain segment. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]!;
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/\\\\]*';
      }
    } else if (char === '?') {
      source += '.';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`(^|[/\\\\])${source}([/\\\\]|$)`, 'i');
}

export function isIgnoredPath(cwd: string, ignorePaths: string[]): boolean {
  const key = pathKey(cwd);
  for (const raw of ignorePaths) {
    const rule = raw.trim();
    if (!rule) continue;
    if (path.isAbsolute(rule)) {
      if (isSubpath(cwd, rule)) return true;
      continue;
    }
    try {
      if (globToRegExp(rule).test(key)) return true;
    } catch {
      // A malformed user rule must never break memory recall.
    }
  }
  return false;
}

export function safeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFileAtomic(file: string, value: unknown): void {
  ensureDirSync(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function directorySize(dir: string): number {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      total += directorySize(path.join(dir, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}
