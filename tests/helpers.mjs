import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeDomain() {
  const tables = new Map();
  const tableFor = (name) => {
    let table = tables.get(name);
    if (!table) {
      table = new Map();
      tables.set(name, table);
    }
    return table;
  };
  const domain = {
    name: 'dsh_smart_memory',
    table(name) {
      const map = tableFor(name);
      return {
        get(key) {
          return map.has(key) ? structuredClone(map.get(key)) : undefined;
        },
        entries() {
          return [...map.entries()].map(([key, value]) => [key, structuredClone(value)])[Symbol.iterator]();
        },
        async put(key, value) {
          map.set(key, structuredClone(value));
        },
        async delete(key) {
          return map.delete(key);
        },
        async deleteMany(keys) {
          let count = 0;
          for (const key of keys) if (map.delete(key)) count += 1;
          return count;
        },
      };
    },
    async close() {},
  };
  return { domain, tables };
}

export function tempDir(prefix = 'dsh-smart-memory-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

export function makeAgent(sessionId, cwd) {
  return {
    id: sessionId,
    session: {
      id: sessionId,
      header: { cwd },
    },
    model: {
      current() {
        return { provider: 'test-provider', model: 'test-model' };
      },
    },
  };
}

export function makeFakeContext({ cwd, agent, llm } = {}) {
  const tools = [];
  const sections = [];
  const listeners = new Map();
  const effects = [];
  const routes = new Map();
  const services = {
    agents: {
      get(id) {
        return agent && agent.id === id ? agent : undefined;
      },
    },
    agentDefaultModel: {
      currentSelection() {
        return { provider: 'test-provider', model: 'test-model' };
      },
    },
    approval: {
      async request() {
        return 'allowed-once';
      },
    },
    llm: llm ?? undefined,
    workspaceRegistry: {
      list() {
        return [];
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
        },
      },
    },
  };
  const ctx = {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
        return () => {};
      },
    },
    storageDomain: {
      async open() {
        throw new Error('test must install a domain');
      },
    },
    on(name, callback) {
      const list = listeners.get(name) ?? [];
      list.push(callback);
      listeners.set(name, list);
      return () => {};
    },
    inject(names, callback) {
      if (names.includes('connection')) callback({ ...ctx, connection: services.connection, effect: ctx.effect });
      if (names.includes('workspaceRegistry')) callback({ ...ctx, workspaceRegistry: services.workspaceRegistry, effect: ctx.effect });
      if (names.includes('approval')) callback({ ...ctx, approval: services.approval, effect: ctx.effect });
      return { dispose() {} };
    },
    effect(callback, _label) {
      const disposer = callback();
      if (typeof disposer === 'function') effects.push(disposer);
      return { dispose() {} };
    },
    get(name) {
      return services[name];
    },
  };
  return { ctx, tools, sections, listeners, effects, routes, services };
}
