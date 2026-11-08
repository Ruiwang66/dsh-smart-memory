# Verification Record — DSH Smart Memory 1.0.0

Date: 2026-11-07 (Asia/Shanghai)  
Verified DSH: **0.2.2-rc.1** (`release.commit` c59d10a)  
Desktop shell: Electron **44.7.0**  
System Node: **24.16.0**; bundled runtime Node: **24.21.0**; pnpm: **11.28.5**  
Plugin target: `dsh-smart-memory@1.0.0`

## 1. Environment and API investigation

The installed Harness was inspected from its asar archive and installed packages, not from old examples:

- `E:\DeepSeek Harness\resources\app.asar` — Harness `0.2.2-rc.1`.
- `C:\Users\a\.dsh\profiles\desktop\cordis.patch.yml` — active desktop profile and model routes.
- `C:\Users\a\.dsh\profiles\desktop\node_modules\dsh-plugin-usage` — a working native plugin used as a compatibility reference for bundle manifests, the `connection.fetch` route registry, and the client `settings.section` slot.
- Bundled package sources inspected: `dsh-system-prompt`, `dsh-tools`, `dsh-agent`, `dsh-agent-loop`, `dsh-session`, `dsh-storage-domain`, `dsh-llm`, `dsh-user-approval`, `dsh-client-connection`, `dsh-client-ui-settings`, `dsh-client-ui-settings-general`, `dsh-web-app`, `dsh-plugin-manager`.

Confirmed native surfaces used by this plugin:

| Capability | Native surface |
|---|---|
| Prompt injection | `ctx.systemPrompt.section({ name, order, interpolate, text })` |
| Tool registration | `ctx.tools.register(definition)` |
| Session lifecycle | `ctx.on('session/event', (session, event) => …)`; `turn/start`, `user/message`, `assistant/message`, `turn/end` |
| Agent/model selection | `ctx.agents.get(id)`, `agent.model.current()`, `agentDefaultModel.currentSelection()` |
| Model call | `ctx.llm.stream({ provider, model, messages, maxTokens, temperature, signal })` |
| Durable storage | `ctx.storageDomain.open(spec)` with `per-record` JSON layout under `$DSH_HOME/storages` |
| Approval | `ctx.approval.request({ agent, toolName, callId, reason, signal })` |
| Browser API | `ctx.inject(['connection'], …)`, `connection.fetch.register({ path, methods, requestBody, fetch })` |
| Web UI | client package `exports['./client']`, `dsh.client.inject`, `window.__ModuleLoader__.load`, `settings.section`, `settings.section.icon` |
| Plugin detail i18n | `locale/<language>.json` `meta.title` / `meta.description` / `meta.detail`; `README.zh.md` and `README.md` |

No Harness core file was modified.

## 2. Build and automated tests

```text
npm test
```

Result: **21/21 tests pass**.

- 10 core tests: Chinese tokenizer/BM25, same-name project isolation, Git/config/registered-path detection, redaction, rule extraction, recall project reservation, persistence, dedupe, conflict, pin/lock/version, import/export.
- 4 plugin integration tests: all 11 tools registered, real tool execute paths, project isolation, session-event enqueue, dynamic recall section, HTTP API.
- 1 LLM extraction test: fake `ctx.llm.stream` JSON → parsed and written to global + project memory.
- 3 bilingual metadata tests: Chinese/English locale files, `meta.detail`, and packaged README selection.
- 2 client rendering tests: self-registration, settings section/icon, first render.
- 1 jsdom interaction test: authenticated API data loads, global tab, settings tab, custom dropdown selection.

Client syntax checks: `node --check lib/client/index.js`, `node --check lib/host/index.js`.

## 3. Real DSH installation

Installed into the running desktop profile through the official `plugin_manager`:

```text
install_bundle: dsh-smart-memory@1.0.0
application: applied
```

`plugin_manager.list_plugins` reports:

```text
entryId: include:smart-memory
moduleName: dsh-smart-memory
enabled: true
fiberPhase: active
```

Installed artifact hashes match the final build:

```text
lib/client/index.js  290B8B…F6D5
lib/host/index.js    EBB6A3…C20A
```

## 4. Real Host/API verification

A separate temporary `web` profile was created under a workspace-local `DSH_HOME`, the final tarball was installed, and a temporary DSH web server was started with a one-time launch token. The temporary server was stopped after verification.

Verified over the real authenticated API:

- `POST /api/smart-memory/health` → `{ plugin: "dsh-smart-memory", version: "1.0.0", dsh: "0.2.2-rc.1" }`.
- `POST /api/smart-memory/save` → created a UTF-8 Chinese memory; `normalizedTitle` was correct.
- `POST /api/smart-memory/memories` → Chinese BM25 search returned the saved memory.
- `POST /api/smart-memory/pin` and `/update` → persisted pin and version history.
- `POST /api/smart-memory/settings/update` → persisted retrieval limit, token budget, conflict policy and archive days.
- `POST /api/smart-memory/overview` → counts, recent, storage bytes, auto status.
- `POST /api/smart-memory/export` and `/import` → round-trip worked.
- `POST /api/smart-memory/audit` → operation records present.
- DSH client boot roster contained `dsh-smart-memory` with inject list `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-settings-general"]`.
- The actual served client bundle returned HTTP 200 and contained `window.__ModuleLoader__`, `dsh-smart-memory`, `智能记忆`, and `settings.section`.

Storage was written in the expected native layout:

```text
<DSH_HOME>/storages/dsh_smart_memory/memories/<mem-id>.json
<DSH_HOME>/storages/dsh_smart_memory/audit/<aud-id>.json
<DSH_HOME>/storages/dsh_smart_memory/settings/default.json
```

Each record document is version-stamped `{ "version": 1, "record": … }`.

## 5. UI verification

The DSH settings page is a native `settings.section` contribution and an icon contribution. The client bundle is served by DSH and was exercised in a jsdom + React test against a mocked native API:

- overview data rendered;
- storage path is rendered on its own full-width row with ellipsis and a native `title` tooltip, so a long `$DSH_HOME` path cannot overflow the stat card;
- dropdowns use the custom accessible `Select` component (soft border, shadow, tinted selected row) instead of the native option menu;
- the tab strip wraps instead of scrolling, and the settings-shell scrollbar is hidden only while this page is mounted, removing the stray vertical bar at the right edge;
- tab switching to global memories loaded the list;
- settings tab rendered the real persisted form;
- no page errors.

A real browser screenshot could not be captured in this sandbox because Chromium/Edge child processes are blocked by the Windows named-pipe sandbox (`spawn EPERM` / mojo `OpenProcess: 拒绝访问`). This is an environment limitation, not a plugin error. The same client bundle was confirmed served and present in the DSH boot roster.

## 6. Bilingual plugin metadata

The DSH plugin manager reads localized display text from every `locale/*.json` dictionary via `readPluginMeta`, and the plugin detail page selects a Markdown document from `meta.detail`.

The package now ships:

- `locale/zh.json` → `meta.title: 智能记忆`, Chinese description, `meta.detail: README.zh.md`.
- `locale/en.json` → `meta.title: Smart Memory`, English description, `meta.detail: README.md`.
- `README.zh.md` and `README.md`.

Chinese DSH UI therefore shows the Chinese title, description and README; English UI shows the English pair. The earlier English-only detail page was caused by the old locale files having top-level `title`/`description` instead of the required `meta` object and no `meta.detail`.

## 7. Known verification gaps

- A live LLM extraction call was not made against the user's paid provider in the temporary profile; the `ctx.llm.stream` path was validated with a fake adapter and the real service contract was inspected in source. The desktop profile has a configured model route.
- The desktop server's launch token is process-local and not exposed to this shell, so the desktop GUI could not be driven by an external browser. The installed plugin fiber is active and the temporary authenticated server verified the identical final tarball.
- `ctx.approval` destructive-action prompts were unit/integration tested with a fake approval service; a real UI approval prompt was not triggered to avoid deleting real memories.
