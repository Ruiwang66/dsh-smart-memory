import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { SmartMemoryStore } from '../lib/host/store.js';
import { ExtractionEngine } from '../lib/host/extraction.js';
import { makeAgent, makeDomain, tempDir, writeFile } from './helpers.mjs';

test('LLM extraction path parses JSON and applies global + project memories', async () => {
  const root = tempDir('dsh-smart-memory-llm-');
  writeFile(path.join(root, 'package.json'), '{"name":"llm-demo"}');
  const agent = makeAgent('session-llm', root);
  const { domain } = makeDomain();
  const store = new SmartMemoryStore(domain, {
    storagePath: tempDir('dsh-smart-memory-llm-store-'),
    logger: { info() {}, warn() {}, error() {} },
  });
  await store.load();
  const candidate = store.resolveProjectCandidate(root);
  assert.ok(candidate);
  const project = await store.ensureProject(candidate, 'session-llm');

  const llm = {
    async *stream() {
      const payload = {
        global: [{
          title: '回答风格',
          content: '用户喜欢直接、真实、带完整步骤的中文回答。',
          category: 'style',
          tags: ['中文', '直接'],
          importance: 5,
          confidence: 0.92,
          operation: 'create',
        }],
        project: [{
          title: '数据库',
          content: '项目使用 PostgreSQL 16。',
          category: 'database',
          tags: ['PostgreSQL'],
          importance: 4,
          confidence: 0.9,
          operation: 'create',
        }],
      };
      yield { type: 'text-delta', index: 0, text: JSON.stringify(payload) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const ctx = {
    get(name) {
      if (name === 'agents') return { get: () => agent };
      if (name === 'llm') return llm;
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test' }) };
      return undefined;
    },
  };
  await store.enqueueJob({
    sessionId: 'session-llm',
    turn: 1,
    projectId: project.id,
    cwd: root,
    input: {
      userText: '我喜欢直接真实的中文回答。这个项目数据库用 PostgreSQL 16。',
      assistantText: '好的，我记住了。',
      excerpt: '用户：我喜欢直接真实的中文回答。这个项目数据库用 PostgreSQL 16。',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const engine = new ExtractionEngine({ store, ctx, logger: { info() {}, warn() {}, error() {} } });
  await engine.tick();
  const global = store.search({ scope: 'global', query: '完整步骤', limit: 5 });
  assert.equal(global.length, 1);
  assert.equal(global[0].memory.title, '回答风格');
  const projectMemories = store.search({ scope: 'project', projectId: project.id, query: 'PostgreSQL', limit: 5 });
  assert.equal(projectMemories.length, 1);
  assert.equal(projectMemories[0].memory.title, '数据库');
  const jobs = store.listJobs(5);
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[0].mode, 'llm');
  engine.stop();
  await store.close();
});
