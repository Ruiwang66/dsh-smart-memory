import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { apply } from '../lib/host/index.js';
import { makeAgent, makeDomain, makeFakeContext, tempDir, writeFile } from './helpers.mjs';

async function bootPlugin() {
  const projectRoot = tempDir('dsh-smart-memory-integration-');
  writeFile(path.join(projectRoot, 'package.json'), '{"name":"integration-demo"}');
  const agent = makeAgent('session-integration', projectRoot);
  const fake = makeFakeContext({ cwd: projectRoot, agent });
  const { domain } = makeDomain();
  fake.ctx.storageDomain.open = async () => domain;
  await apply(fake.ctx);
  return { ...fake, projectRoot, agent, domain };
}

function tool(name, tools) {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, `tool ${name} registered`);
  return found;
}

test('plugin registers all 11 memory tools and the dynamic recall section', async () => {
  const boot = await bootPlugin();
  const names = boot.tools.map((item) => item.name).sort();
  assert.deepEqual(names, [
    'memory_delete', 'memory_export', 'memory_forget', 'memory_import', 'memory_list',
    'memory_pin', 'memory_save', 'memory_search', 'memory_stats', 'memory_unpin', 'memory_update',
  ]);
  assert.equal(boot.sections.length, 1);
  assert.equal(boot.sections[0].name, 'smart-memory:context');
  assert.equal(boot.routes.size, 20);
  for (const disposer of boot.effects.reverse()) await disposer();
});

test('memory_save + memory_search work through the real tool definitions and isolate projects', async () => {
  const boot = await bootPlugin();
  const save = tool('memory_save', boot.tools);
  const search = tool('memory_search', boot.tools);
  const exec = { agent: boot.agent, callId: 'call-1', signal: new AbortController().signal };

  const savedGlobal = await save.execute({
    scope: 'global',
    title: '中文偏好',
    content: '用户喜欢中文交流，技术问题需要完整步骤。',
    category: 'language',
    importance: 5,
  }, exec);
  assert.equal(savedGlobal.created, true);

  const savedProject = await save.execute({
    scope: 'project',
    title: '数据库',
    content: '项目使用 PostgreSQL 16，连接串在环境变量 DATABASE_URL。',
    category: 'database',
    importance: 4,
  }, exec);
  assert.equal(savedProject.created, true);

  const result = await search.execute({ query: 'PostgreSQL', scope: 'project', limit: 5 }, exec);
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].title, '数据库');

  // A different project must not see the current project's private memory.
  const otherRoot = tempDir('dsh-smart-memory-other-');
  writeFile(path.join(otherRoot, 'package.json'), '{"name":"other-demo"}');
  const otherAgent = makeAgent('session-other', otherRoot);
  const otherExec = { agent: otherAgent, callId: 'call-2', signal: new AbortController().signal };
  const otherResult = await search.execute({ query: 'PostgreSQL', scope: 'project', limit: 5 }, otherExec);
  assert.equal(otherResult.memories.length, 0);

  const globalResult = await search.execute({ query: '完整步骤', scope: 'global', limit: 5 }, exec);
  assert.equal(globalResult.memories[0].title, '中文偏好');

  for (const disposer of boot.effects.reverse()) await disposer();
});

test('session events enqueue extraction and the dynamic section recalls the current project only', async () => {
  const boot = await bootPlugin();
  const save = tool('memory_save', boot.tools);
  const exec = { agent: boot.agent, callId: 'call-3', signal: new AbortController().signal };
  await save.execute({
    scope: 'project',
    title: '数据库决策',
    content: '项目数据库使用 PostgreSQL 16。',
    category: 'database',
    importance: 4,
  }, exec);

  const session = boot.agent.session;
  const emit = (event) => {
    for (const listener of boot.listeners.get('session/event') ?? []) listener(session, event);
  };
  emit({ type: 'turn/start', seq: 1, data: { turn: 1 } });
  emit({
    type: 'user/message',
    seq: 2,
    data: {
      role: 'user',
      content: [{ type: 'text', text: '我们的数据库用的是什么？' }],
      source: { kind: 'user' },
    },
  });
  emit({
    type: 'assistant/message',
    seq: 3,
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '项目使用 PostgreSQL 16。' }],
        source: { kind: 'assistant' },
      },
    },
  });
  emit({ type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } });

  const sectionText = boot.sections[0].text({ agent: boot.agent });
  assert.ok(sectionText.includes('长期记忆'));
  assert.ok(sectionText.includes('PostgreSQL'));

  await new Promise((resolve) => setTimeout(resolve, 250));
  const jobsRoute = boot.routes.get('/api/smart-memory/jobs');
  assert.ok(jobsRoute);
  const response = await jobsRoute.fetch(new Request('http://localhost/api/smart-memory/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.ok(payload.value.jobs.length >= 1);

  for (const disposer of boot.effects.reverse()) await disposer();
});

test('HTTP API serves overview, settings and memory list', async () => {
  const boot = await bootPlugin();
  const call = async (endpoint, body = {}) => {
    const route = boot.routes.get('/api/smart-memory/' + endpoint);
    assert.ok(route, `route ${endpoint}`);
    const response = await route.fetch(new Request('http://localhost/api/smart-memory/' + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return response.json();
  };

  const health = await call('health');
  assert.equal(health.ok, true);
  assert.equal(health.value.plugin, 'dsh-smart-memory');

  const saved = await call('save', {
    scope: 'global',
    title: 'API 测试',
    content: '通过 HTTP API 保存的全局记忆。',
    category: 'other',
    importance: 3,
  });
  assert.equal(saved.ok, true);

  const overview = await call('overview');
  assert.equal(overview.ok, true);
  assert.equal(overview.value.total, 1);
  assert.equal(overview.value.global, 1);

  const settings = await call('settings/update', {
    settings: { retrievalLimit: 12, autoRecall: false, conflictPolicy: 'prefer_new' },
  });
  assert.equal(settings.ok, true);
  assert.equal(settings.value.settings.retrievalLimit, 12);
  assert.equal(settings.value.settings.autoRecall, false);

  const listed = await call('memories', { scope: 'global', query: 'HTTP API' });
  assert.equal(listed.ok, true);
  assert.equal(listed.value.memories.length, 1);

  for (const disposer of boot.effects.reverse()) await disposer();
});
