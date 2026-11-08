import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SmartMemoryStore } from '../lib/host/store.js';
import { MemoryIndex, selectRecallMemories } from '../lib/host/retrieval.js';
import { detectProject, projectIdForRoot } from '../lib/host/project.js';
import { heuristicExtract } from '../lib/host/extraction.js';
import { redactSensitive, tokenize } from '../lib/host/util.js';
import { DEFAULT_SETTINGS } from '../lib/host/types.js';
import { makeDomain, tempDir, writeFile } from './helpers.mjs';

async function makeStore() {
  const { domain } = makeDomain();
  const storagePath = tempDir('dsh-smart-memory-store-');
  const store = new SmartMemoryStore(domain, { storagePath, logger: { info() {}, warn() {}, error() {} } });
  await store.load();
  return { store, domain, storagePath };
}

function candidateFor(root, name = '测试项目') {
  return {
    id: projectIdForRoot(root),
    name,
    rootPath: root,
    canonicalKey: root.replace(/\\/g, '/').toLowerCase(),
    markers: ['package.json'],
  };
}

test('Chinese hybrid tokenizer covers unigrams and bigrams', () => {
  const tokens = tokenize('回答风格 direct');
  assert.ok(tokens.includes('回'));
  assert.ok(tokens.includes('回答'));
  assert.ok(tokens.includes('风格'));
  assert.ok(tokens.includes('direct'));
});

test('BM25 search finds a Chinese preference without a dictionary', () => {
  const index = new MemoryIndex();
  const now = Date.now();
  const base = {
    scope: 'global',
    category: 'style',
    tags: [],
    importance: 4,
    confidence: 0.9,
    status: 'active',
    pinned: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    source: { kind: 'manual' },
    conflictWith: [],
    versions: [],
    revision: 1,
  };
  index.upsert({
    ...base,
    id: 'mem_1',
    title: '回答风格偏好',
    content: '用户喜欢直接、真实、有操作步骤的回答，不喜欢夸张赞美。',
    normalizedTitle: '回答风格偏好',
  });
  index.upsert({
    ...base,
    id: 'mem_2',
    title: '数据库选择',
    content: '项目使用 PostgreSQL 数据库。',
    normalizedTitle: '数据库选择',
  });
  const results = index.search({ scope: 'global', query: '回答风格 直接', limit: 5 });
  assert.equal(results[0].memory.id, 'mem_1');
});

test('same folder name in different locations produces different project ids', () => {
  const left = tempDir('dsh-smart-memory-left-');
  const right = tempDir('dsh-smart-memory-right-');
  const leftDemo = path.join(left, 'demo');
  const rightDemo = path.join(right, 'demo');
  writeFile(path.join(leftDemo, 'package.json'), '{"name":"left-demo"}');
  writeFile(path.join(rightDemo, 'package.json'), '{"name":"right-demo"}');
  const a = detectProject(leftDemo, [], []);
  const b = detectProject(rightDemo, [], []);
  assert.ok(a && b);
  assert.notEqual(a.id, b.id);
  assert.equal(a.rootPath, leftDemo);
  assert.equal(b.rootPath, rightDemo);
});

test('git root wins over a nested config root, registered path wins when no marker exists', () => {
  const root = tempDir('dsh-smart-memory-git-');
  const repo = path.join(root, 'repo');
  const nested = path.join(repo, 'packages', 'app');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  writeFile(path.join(nested, 'package.json'), '{"name":"nested-app"}');
  const git = detectProject(nested, [], []);
  assert.ok(git);
  assert.equal(git.rootPath, repo);

  const registeredRoot = path.join(root, 'registered');
  const child = path.join(registeredRoot, 'sub');
  fs.mkdirSync(child, { recursive: true });
  const record = {
    id: projectIdForRoot(registeredRoot),
    name: '已登记项目',
    rootPath: registeredRoot,
    canonicalKey: registeredRoot.replace(/\\/g, '/').toLowerCase(),
    markers: [],
    aliases: [],
    sessionIds: [],
    createdAt: 1,
    updatedAt: 1,
    lastActiveAt: 1,
    pinned: false,
    archived: false,
  };
  const mapped = detectProject(child, [record], []);
  assert.ok(mapped);
  assert.equal(mapped.id, record.id);
});

test('sensitive filter redacts keys, passwords and identity numbers', () => {
  const text = 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456 password=hello123 身份证 110101199001011234';
  const redacted = redactSensitive(text);
  assert.ok(!redacted.includes('sk-abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(!redacted.includes('hello123'));
  assert.ok(!redacted.includes('110101199001011234'));
});

test('heuristic extraction only uses the user side for global preferences', () => {
  const result = heuristicExtract({
    userText: '我喜欢用中文交流，请记住回答要直接、真实，并给出完整操作步骤。',
    assistantText: '你使用 Windows 和 PowerShell 进行开发。这个项目使用 React 和 PostgreSQL。',
    projectId: 'prj_0123456789abcdef',
    projectName: 'Demo',
  });
  assert.ok(result.global.length >= 1);
  assert.ok(result.global.every((item) => !item.content.includes('Windows')));
  assert.ok(result.project.length >= 1);
});

test('recall reserves slots for the current project when global preferences are numerous', () => {
  const index = new MemoryIndex();
  const timestamp = Date.now();
  const base = {
    category: 'preference',
    tags: [],
    confidence: 0.9,
    status: 'active',
    pinned: false,
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    accessCount: 0,
    source: { kind: 'manual' },
    conflictWith: [],
    versions: [],
    revision: 1,
  };
  for (let i = 0; i < 8; i += 1) {
    index.upsert({
      ...base,
      id: `mem_global_${i}`,
      scope: 'global',
      title: `全局偏好 ${i}`,
      content: '用户喜欢中文、直接、完整的回答。',
      importance: 5,
      normalizedTitle: `全局偏好 ${i}`,
    });
  }
  const projectId = 'prj_0123456789abcdef';
  index.upsert({
    ...base,
    id: 'mem_project_db',
    scope: 'project',
    projectId,
    category: 'database',
    title: '项目数据库',
    content: '项目数据库使用 PostgreSQL 16。',
    importance: 4,
    normalizedTitle: '项目数据库',
  });
  const selected = selectRecallMemories(index, '数据库 PostgreSQL', projectId, {
    ...DEFAULT_SETTINGS,
    retrievalLimit: 4,
    contextTokenBudget: 1200,
  }, '演示项目');
  assert.ok(selected.length <= 4);
  assert.ok(selected.some((memory) => memory.id === 'mem_project_db'));
  assert.ok(selected.some((memory) => memory.scope === 'global'));
});

test('store persists global and project memories, dedupes and searches', async () => {
  const { store, domain, storagePath } = await makeStore();
  const projectRoot = tempDir('dsh-smart-memory-project-');
  writeFile(path.join(projectRoot, 'package.json'), '{"name":"demo-project"}');
  const project = await store.ensureProject(candidateFor(projectRoot, 'Demo 项目'), 'session-1');

  const global = await store.saveMemory({
    scope: 'global',
    title: '中文回答偏好',
    content: '用户喜欢中文交流，希望技术问题给出完整操作步骤。',
    category: 'language',
    importance: 5,
    source: { kind: 'manual', sessionId: 'session-1' },
  });
  assert.equal(global.created, true);

  const projectMemory = await store.saveMemory({
    scope: 'project',
    projectId: project.id,
    title: '技术栈',
    content: '项目使用 TypeScript、React 和 SQLite。',
    category: 'tech_stack',
    importance: 4,
    source: { kind: 'manual', sessionId: 'session-1' },
  });
  assert.equal(projectMemory.created, true);

  const duplicate = await store.saveMemory({
    scope: 'global',
    title: '中文回答偏好',
    content: '用户喜欢中文交流，希望技术问题给出完整操作步骤。',
    category: 'language',
    importance: 5,
    source: { kind: 'auto' },
  });
  assert.equal(duplicate.created, false);
  assert.equal(store.stats().global, 1);

  const results = store.search({ scope: 'auto', projectId: project.id, query: '完整操作步骤', limit: 5 });
  assert.equal(results[0].memory.id, global.memory.id);
  const projectResults = store.search({ scope: 'project', projectId: project.id, query: 'TypeScript', limit: 5 });
  assert.equal(projectResults[0].memory.id, projectMemory.memory.id);

  const otherProjectResults = store.search({ scope: 'auto', projectId: 'prj_ffffffffffffffff', query: 'TypeScript', limit: 5 });
  assert.equal(otherProjectResults.length, 0);

  const reloaded = new SmartMemoryStore(domain, { storagePath, logger: { info() {}, warn() {}, error() {} } });
  await reloaded.load();
  assert.equal(reloaded.stats().total, 2);
  assert.equal(reloaded.getProject(project.id)?.name, 'Demo 项目');
});

test('conflict policy keeps both records and marks them for confirmation', async () => {
  const { store } = await makeStore();
  await store.updateSettings({ conflictPolicy: 'keep_both' });
  const first = await store.saveMemory({
    scope: 'global',
    title: '开发系统',
    content: '用户主要使用 Windows 10 开发。',
    category: 'tool',
    importance: 4,
    source: { kind: 'manual' },
  });
  const second = await store.saveMemory({
    scope: 'global',
    title: '开发系统',
    content: '用户目前主要使用 Windows 11 开发。',
    category: 'tool',
    importance: 4,
    operation: 'conflict',
    targetId: first.memory.id,
    source: { kind: 'auto' },
  });
  assert.equal(second.conflict, true);
  assert.equal(store.getMemory(first.memory.id)?.status, 'conflict');
  assert.equal(store.getMemory(second.memory.id)?.status, 'pending_confirmation');
  assert.ok(store.getMemory(first.memory.id)?.conflictWith.includes(second.memory.id));
});

test('pin, lock, update, export and import round-trip', async () => {
  const { store } = await makeStore();
  const saved = await store.saveMemory({
    scope: 'global',
    title: '回答风格',
    content: '直接、真实，不要夸张赞美。',
    category: 'style',
    importance: 4,
    source: { kind: 'manual' },
  });
  const pinned = await store.setPinned(saved.memory.id, true);
  assert.equal(pinned.pinned, true);
  const locked = await store.setLocked(saved.memory.id, true);
  assert.equal(locked.locked, true);
  await assert.rejects(() => store.updateMemory(saved.memory.id, {
    content: '试图覆盖',
    source: { kind: 'auto' },
  }));
  const updated = await store.updateMemory(saved.memory.id, {
    content: '直接、真实、可操作，不要夸张赞美。',
    force: true,
    source: { kind: 'manual' },
  });
  assert.equal(updated.versions.length, 3);

  const bundle = store.exportBundle('all', undefined, true);
  assert.equal(bundle.memories.length, 1);
  const { store: target } = await makeStore();
  const imported = await target.importBundle(bundle, 'merge', { kind: 'import' });
  assert.equal(imported.imported, 1);
  assert.equal(target.stats().total, 1);
  assert.equal(target.allMemories()[0].title, '回答风格');
});
