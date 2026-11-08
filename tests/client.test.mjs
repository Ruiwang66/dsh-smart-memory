import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';

function loadClient() {
  const code = fs.readFileSync(new URL('../lib/client/index.js', import.meta.url), 'utf8');
  let exports;
  const window = {
    __ModuleLoader__: {
      load(definition) {
        assert.equal(definition.id, 'dsh-smart-memory');
        exports = definition.factory((name) => {
          if (name === 'react') return React;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  const styles = { insert() { return () => {}; } };
  const context = vm.createContext({
    window,
    styles,
    console,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('fetch is not available in this test')),
    URL,
    Blob: globalThis.Blob,
    document: undefined,
  });
  vm.runInContext(code, context, { filename: 'lib/client/index.js' });
  return { exports, window };
}

test('client bundle self-registers and registers a settings section + icon', () => {
  const { exports } = loadClient();
  assert.equal(typeof exports.apply, 'function');
  assert.equal(exports.inject.length, 1);
  assert.equal(exports.inject[0], 'slots');
  const registrations = [];
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
            registrations.push({ options, component });
            return () => {};
          },
        };
      }
      return undefined;
    },
  };
  exports.apply(ctx);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].options.id, 'smart-memory');
  assert.equal(registrations[1].options.name, 'settings.section.icon');
});

test('client page renders without a host API and shows its loading state', () => {
  const { exports } = loadClient();
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
  assert.equal(typeof page, 'function');
  const html = renderToString(React.createElement(page, {}));
  assert.ok(html.includes('智能记忆'));
  assert.ok(html.includes('正在加载概览'));
  assert.ok(html.includes('全局记忆'));
  assert.ok(html.includes('项目记忆'));
  assert.ok(html.includes('自动记忆设置'));
});
