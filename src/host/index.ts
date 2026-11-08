import path from 'node:path';
import type { ProjectRecord } from './types.js';
import { SmartMemoryStore, smartMemoryDomainSpec } from './store.js';
import { ExtractionEngine, buildTurnInput } from './extraction.js';
import { registerMemoryTools } from './tools.js';
import { registerApiRoutes } from './rpc.js';
import { buildRecallPrompt } from './retrieval.js';
import { dshHome, isIgnoredPath, messageText, now, redactSensitive, safeError } from './util.js';

export const name = 'smart-memory';
export const inject = ['tools', 'systemPrompt', 'sessions', 'storageDomain'];

interface TurnBuffer {
  turn: number;
  userText: string;
  assistantText: string;
  lastSeq: number;
}

interface LoggerLike {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

function safeLogger(ctx: any): LoggerLike {
  try {
    const logger = ctx?.logger;
    if (logger && typeof logger.info === 'function') {
      return {
        info: (message: string) => logger.info(message),
        warn: (message: string) => (typeof logger.warn === 'function' ? logger.warn(message) : logger.info(message)),
        error: (message: string) => (typeof logger.error === 'function' ? logger.error(message) : logger.info(message)),
      };
    }
  } catch {
    // fall through
  }
  return {
    info: (message: string) => console.log(message),
    warn: (message: string) => console.warn(message),
    error: (message: string) => console.error(message),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openDomain(ctx: any): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await ctx.storageDomain.open(smartMemoryDomainSpec());
    } catch (error: any) {
      lastError = error;
      if (error?.code === 'already-open' && attempt < 2) {
        await delay(350);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function sessionIdOf(session: any): string | undefined {
  return typeof session?.id === 'string' ? session.id : undefined;
}

function sessionCwd(session: any): string | undefined {
  const cwd = session?.header?.cwd;
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
}

function userMessageOf(event: any): any | undefined {
  if (event?.type !== 'user/message' || !event.data || typeof event.data !== 'object') return undefined;
  const message = event.data;
  const source = message.source && typeof message.source === 'object' ? message.source : {};
  // Only the human's own prompt is conversation input. Injected runtime context
  // (working directory, approval policy, time) has other source kinds and must
  // never become long-term memory.
  if (source.kind !== 'user') return undefined;
  return message;
}

function assistantTextOf(event: any): string {
  if (event?.type !== 'assistant/message') return '';
  const message = event.data?.message;
  if (!message) return '';
  return messageText(message.content);
}

/**
 * DSH Smart Memory host entry.
 *
 * The plugin is a native Cordis plugin: it registers model tools and a dynamic
 * system-prompt section, consumes the session event feed for asynchronous
 * extraction, and mounts browser API routes on DSH Connection. It does not
 * modify Harness core files or the original conversation history.
 */
export async function apply(ctx: any): Promise<void> {
  const logger = safeLogger(ctx);
  const storagePath = path.join(dshHome(), 'storages', 'dsh_smart_memory');
  const domain = await openDomain(ctx);
  const store = new SmartMemoryStore(domain, { storagePath, logger });
  await store.load();

  const engine = new ExtractionEngine({ store, ctx, logger });
  const turnBuffers = new Map<string, TurnBuffer>();
  const latestUserText = new Map<string, { text: string; at: number }>();
  const recallCache = new Map<string, { key: string; text: string; at: number }>();

  const getAgent = (sessionId: string): any => {
    try {
      return ctx.get('agents')?.get?.(sessionId);
    } catch {
      return undefined;
    }
  };

  const refreshWorkspaceHints = (registry?: any) => {
    try {
      const workspaces = registry?.list?.();
      if (!Array.isArray(workspaces)) return;
      store.setWorkspaceHints(
        workspaces
          .filter((workspace: any) => typeof workspace?.path === 'string')
          .map((workspace: any) => ({
            path: workspace.path,
            ...typeof workspace.id === 'string' ? { id: workspace.id } : {},
            ...typeof workspace.title === 'string' ? { title: workspace.title } : {},
          })),
      );
    } catch (error) {
      logger.warn?.(`[smart-memory] workspace hint refresh failed: ${safeError(error)}`);
    }
  };

  ctx.inject(['workspaceRegistry'], (workspaceCtx: any) => {
    refreshWorkspaceHints(workspaceCtx.workspaceRegistry);
    const timer = setInterval(() => refreshWorkspaceHints(workspaceCtx.workspaceRegistry), 60_000);
    timer.unref?.();
    workspaceCtx.effect(() => () => clearInterval(timer), 'smart-memory.workspaceHints');
  });

  // Register tools before the first turn can assemble a prompt.
  registerMemoryTools({ ctx, store, logger });

  // Dynamic, per-step recall. The section function is synchronous and reads the
  // in-memory index; it never performs I/O or blocks the agent loop.
  ctx.systemPrompt.section({
    name: 'smart-memory:context',
    order: 9000,
    interpolate: false,
    text: (assembly: any) => {
      const settings = store.getSettings();
      if (!settings.autoRecall) return '';
      const agent = assembly?.agent;
      const session = agent?.session;
      const sessionId = sessionIdOf(session);
      if (!sessionId) return '';
      const cwd = sessionCwd(session);
      const candidate = store.resolveProjectCandidate(cwd);
      const projectId = candidate?.id;
      const project = projectId ? store.getProject(projectId) : undefined;
      const query = latestUserText.get(sessionId)?.text ?? '';
      const cacheKey = [
        sessionId,
        projectId ?? '',
        query,
        store.revision,
        settings.retrievalLimit,
        settings.contextTokenBudget,
        project?.name ?? '',
      ].join('\u0000');
      const cached = recallCache.get(sessionId);
      if (cached && cached.key === cacheKey) return cached.text;
      try {
        const memories = store.recall(query, projectId, project?.name);
        const text = buildRecallPrompt(memories, settings, project?.name);
        recallCache.set(sessionId, { key: cacheKey, text, at: now() });
        if (recallCache.size > 200) {
          const oldest = [...recallCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, recallCache.size - 200);
          for (const [id] of oldest) recallCache.delete(id);
        }
        return text;
      } catch (error) {
        logger.warn?.(`[smart-memory] recall failed: ${safeError(error)}`);
        return '';
      }
    },
  });

  const handleTurnEnd = async (session: any, event: any) => {
    const sessionId = sessionIdOf(session);
    if (!sessionId) return;
    if (session?.header?.origin === 'subagent') return;
    const buffer = turnBuffers.get(sessionId);
    turnBuffers.delete(sessionId);
    const userText = buffer?.userText?.trim();
    const assistantText = buffer?.assistantText?.trim();
    if (!userText) return;
    const settings = store.getSettings();
    if (!settings.autoGlobal && !settings.autoProject) return;
    const cwd = sessionCwd(session);
    const candidate = store.resolveProjectCandidate(cwd);
    if (cwd && settings.ignorePaths.length > 0) {
      if (isIgnoredPath(cwd, settings.ignorePaths)) return;
    }
    let project: ProjectRecord | undefined;
    if (candidate) {
      // Persist the job first, then register the project. A crash between the
      // two must not lose the turn; the worker can recreate the project from
      // the job's cwd.
      project = store.getProject(candidate.id);
    }
    if (!settings.autoGlobal && !project && !candidate) return;
    const agent = getAgent(sessionId);
    const selection = agent?.model?.current?.();
    const input = buildTurnInput(
      userText,
      assistantText ?? '',
      selection?.provider,
      selection?.model,
      selection?.reasoningEffort,
    );
    if (settings.sensitiveFilter) {
      input.userText = redactSensitive(input.userText);
      input.assistantText = redactSensitive(input.assistantText);
      input.excerpt = redactSensitive(input.excerpt);
    }
    const turn = typeof event?.data?.turn === 'number' ? event.data.turn : buffer?.turn ?? 0;
    try {
      const job = await store.enqueueJob({
        sessionId,
        turn,
        ...candidate?.id === undefined ? {} : { projectId: candidate.id },
        ...cwd === undefined ? {} : { cwd },
        input,
      });
      if (job) engine.schedule();
      if (candidate && !project) {
        void store.ensureProject(candidate, sessionId).catch((error) => {
          logger.warn?.(`[smart-memory] could not register project: ${safeError(error)}`);
        });
      }
    } catch (error) {
      logger.warn?.(`[smart-memory] could not enqueue extraction: ${safeError(error)}`);
    }
  };

  ctx.on('session/event', (session: any, event: any) => {
    const sessionId = sessionIdOf(session);
    if (!sessionId || !event || typeof event.type !== 'string') return;
    if (event.type === 'turn/start') {
      const turn = typeof event.data?.turn === 'number' ? event.data.turn : 0;
      turnBuffers.set(sessionId, { turn, userText: '', assistantText: '', lastSeq: event.seq ?? 0 });
      return;
    }
    if (event.type === 'user/message') {
      const message = userMessageOf(event);
      if (!message) return;
      const text = messageText(message.content).trim();
      if (!text) return;
      const buffer = turnBuffers.get(sessionId) ?? { turn: 0, userText: '', assistantText: '', lastSeq: 0 };
      buffer.userText = `${buffer.userText}\n${text}`.trim().slice(0, 12_000);
      buffer.lastSeq = event.seq ?? buffer.lastSeq;
      turnBuffers.set(sessionId, buffer);
      latestUserText.set(sessionId, { text: text.slice(0, 6000), at: now() });
      return;
    }
    if (event.type === 'assistant/message') {
      const text = assistantTextOf(event);
      if (!text) return;
      const buffer = turnBuffers.get(sessionId) ?? { turn: 0, userText: '', assistantText: '', lastSeq: 0 };
      buffer.assistantText = `${buffer.assistantText}\n${text}`.trim().slice(0, 12_000);
      buffer.lastSeq = event.seq ?? buffer.lastSeq;
      turnBuffers.set(sessionId, buffer);
      return;
    }
    if (event.type === 'turn/end') {
      void handleTurnEnd(session, event);
    }
  });

  ctx.on('session/disposed', (session: any) => {
    const sessionId = sessionIdOf(session);
    if (!sessionId) return;
    turnBuffers.delete(sessionId);
    latestUserText.delete(sessionId);
    recallCache.delete(sessionId);
  });

  registerApiRoutes({ ctx, store, engine, logger });

  engine.start();

  const maintenance = setInterval(() => {
    void store.archiveOld().catch((error) => logger.warn?.(`[smart-memory] archive failed: ${safeError(error)}`));
    void store.cleanupJobs().catch((error) => logger.warn?.(`[smart-memory] job cleanup failed: ${safeError(error)}`));
    // Keep the recall cache from retaining sessions that were never disposed
    // (for example after a Host restart or an archived browser tab).
    if (recallCache.size > 300) {
      const cutoff = now() - 6 * 60 * 60 * 1000;
      for (const [id, entry] of recallCache) if (entry.at < cutoff) recallCache.delete(id);
    }
  }, 6 * 60 * 60 * 1000);
  maintenance.unref?.();

  const startupTimer = setTimeout(() => {
    void store.archiveOld().catch((error) => logger.warn?.(`[smart-memory] startup archive failed: ${safeError(error)}`));
  }, 15_000);
  startupTimer.unref?.();

  ctx.effect(() => {
    return async () => {
      engine.stop();
      clearInterval(maintenance);
      clearTimeout(startupTimer);
      try {
        await store.close();
      } catch (error) {
        logger.warn?.(`[smart-memory] store close failed: ${safeError(error)}`);
      }
    };
  }, 'smart-memory.lifecycle');

  logger.info?.(`[smart-memory] ready: storage=${storagePath}, memories=${store.stats().total}`);
}
