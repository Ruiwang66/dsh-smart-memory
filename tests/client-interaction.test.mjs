import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const act = React.act ?? (await import('react-dom/test-utils')).act;

function response(value) {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sampleMemory(overrides = {}) {
  const now = Date.now();
  return {
    id: 'mem_11111111-1111-4111-8111-111111111111',
    scope: 'global',
    category: 'language',
    title: '中文回答偏好',
    content: '用户喜欢中文交流，技术问题需要完整操作步骤。',
    tags: ['中文'],
    importance: 5,
    confidence: 0.9,
    status: 'active',
    pinned: true,
    locked: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    source: { kind: 'manual' },
    conflictWith: [],
    versions: [],
    revision: 1,
    ...overrides,
  };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:50601/',
    pretendToBeVisual: true,
  });
  const requests = [];
  const fetchMock = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ path, body });
    if (path.endsWith('/overview')) {
      return response({
        total: 1,
        global: 1,
        project: 0,
        active: 1,
        archived: 0,
        pending: 0,
        pinned: 1,
        projects: 1,
        queueDepth: 0,
        storageBytes: 2048,
        processedJobs: 0,
        revision: 1,
        recent: [sampleMemory()],
        lastUpdatedAt: Date.now(),
        settings: {
          autoGlobal: true,
          autoProject: true,
          autoSummarize: true,
          autoRecall: true,
          conflictPolicy: 'merge',
          retrievalLimit: 8,
          contextTokenBudget: 1200,
          sensitiveFilter: true,
          autoArchiveDays: 180,
          ignorePaths: ['node_modules'],
          storagePath: 'G:/dsh/storages/dsh_smart_memory',
        },
        autoStatus: { enabled: true, running: false, queueDepth: 0 },
      });
    }
    if (path.endsWith('/projects')) {
      return response({
        projects: [{
          id: 'prj_0123456789abcdef',
          name: '演示项目',
          rootPath: 'G:/work/demo',
          canonicalKey: 'g:/work/demo',
          markers: ['package.json'],
          aliases: [],
          sessionIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastActiveAt: Date.now(),
          pinned: false,
          archived: false,
          memoryCount: 1,
          activeCount: 1,
        }],
      });
    }
    if (path.endsWith('/settings/get')) {
      return response({
        storagePath: 'G:/dsh/storages/dsh_smart_memory',
        version: '1.0.0',
        settings: {
          autoGlobal: true,
          autoProject: true,
          autoSummarize: true,
          autoRecall: true,
          conflictPolicy: 'merge',
          retrievalLimit: 8,
          contextTokenBudget: 1200,
          sensitiveFilter: true,
          autoArchiveDays: 180,
          ignorePaths: ['node_modules'],
          storagePath: 'G:/dsh/storages/dsh_smart_memory',
        },
      });
    }
    if (path.endsWith('/memories')) {
      return response({ total: 1, memories: [sampleMemory()], project: null });
    }
    if (path.endsWith('/settings/update')) {
      return response({ settings: body.settings, storagePath: 'G:/dsh/storages/dsh_smart_memory' });
    }
    return response({});
  };
  return { dom, fetchMock, requests };
}

function loadPage(dom, fetchMock) {
  const code = fs.readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8');
  let exports;
  const window = dom.window;
  window.__ModuleLoader__ = {
    load(definition) {
      exports = definition.factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require: ${name}`);
      });
    },
  };
  const context = vm.createContext({
    window,
    document: window.document,
    console,
    setTimeout,
    clearTimeout,
    fetch: fetchMock,
    URL: window.URL,
    Blob: window.Blob,
    navigator: window.navigator,
    styles: undefined,
    React,
  });
  vm.runInContext(code, context, { filename: 'lib/client/index.js' });
  let page;
  const ctx = {
    effect(callback) {
      const disposer = callback();
      return { dispose() { if (typeof disposer === 'function') disposer(); } };
    },
    get(name) {
      if (name === 'slots') {
        return {
          inject(_slot, callback) { callback(); },
          register(options, component) {
            if (options.name === 'settings.section') page = component;
            return () => {};
          },
        };
      }
      return undefined;
    },
  };
  exports.apply(ctx);
  return page;
}

test('client page loads API data and switches between global and settings tabs', async () => {
  const { dom, fetchMock, requests } = setupDom();
  const page = loadPage(dom, fetchMock);
  const container = dom.window.document.getElementById('root');
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    root.render(React.createElement(page));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const text = container.textContent;
  assert.ok(text.includes('智能记忆'));
  assert.ok(text.includes('记忆总数'));
  assert.ok(text.includes('中文回答偏好'));
  assert.ok(text.includes('存储位置'));
  assert.ok(text.includes('G:/dsh/storages/dsh_smart_memory'));
  assert.ok(requests.some((request) => request.path.endsWith('/overview')));

  const globalTab = [...container.querySelectorAll('button')].find((button) => button.textContent === '全局记忆');
  assert.ok(globalTab);
  await act(async () => {
    globalTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  assert.ok(container.textContent.includes('共 1 条全局记忆'));
  assert.ok(container.textContent.includes('中文回答偏好'));

  const settingsTab = [...container.querySelectorAll('button')].find((button) => button.textContent === '自动记忆设置');
  assert.ok(settingsTab);
  await act(async () => {
    settingsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(container.textContent.includes('全局自动记忆'));
  assert.ok(container.textContent.includes('上下文 Token 预算'));
  assert.ok(container.textContent.includes('保存设置'));

  const conflictTrigger = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('自动合并补充'));
  assert.ok(conflictTrigger);
  await act(async () => {
    conflictTrigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.ok(container.textContent.includes('以最新信息为准'));
  const preferNew = [...container.querySelectorAll('button')].find((button) => button.textContent === '以最新信息为准');
  assert.ok(preferNew);
  await act(async () => {
    preferNew.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.ok(container.textContent.includes('以最新信息为准'));
  assert.ok(!container.textContent.includes('自动合并补充'));

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
