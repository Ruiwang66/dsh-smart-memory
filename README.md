# DSH Smart Memory · 智能记忆

[![CI](https://github.com/Ruiwang66/dsh-smart-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruiwang66/dsh-smart-memory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4c6ef5.svg)](https://github.com/Ruiwang66/dsh-smart-memory/releases)

[中文](README.zh.md) | **English**

A native long-term memory plugin for **DeepSeek Harness 0.2.2-rc.1**.

It gives DSH a ChatGPT-Memory-like experience: stable user preferences, background, language and working style are remembered across sessions, while each project gets a strictly isolated memory space.

> Target: `dsh-smart-memory@1.0.0`  
> Verified DSH: `0.2.2-rc.1` (`engines.dsh: >=0.2.1-rc.3 <0.3.0`)  
> Runtime: Node.js >= 22

## Bilingual metadata

The Plugins page follows the DSH interface language:

- Chinese UI: `locale/zh.json` → “智能记忆”, with `README.zh.md`.
- English UI: `locale/en.json` → “Smart Memory”, with `README.md`.

The in-app memory management page is Chinese-first; a full English UI can be added in a follow-up if needed.

## Features

- **Two memory layers**: global user memory shared by every project, and per-project memory isolated by canonical workspace path.
- **Automatic extraction**: a durable, asynchronous queue summarizes each completed turn without blocking conversation; retries, deduplication and crash recovery are built in.
- **Automatic recall**: a dynamic native `ctx.systemPrompt.section()` injects only relevant global + current-project memories at each model step. Chat history and system configuration are never modified.
- **Chinese-ready hybrid retrieval**: BM25 + CJK character unigram/bigram + tags + importance + pin + recency. Fully local; no cloud embedding dependency.
- **11 model tools**: `memory_search`, `memory_save`, `memory_update`, `memory_delete`, `memory_list`, `memory_pin`, `memory_unpin`, `memory_stats`, `memory_export`, `memory_import`, `memory_forget`.
- **Management UI**: Settings → Smart Memory, with overview, global memories, projects, settings; search, create, edit, delete, pin, lock, export/import and clear.
- **Native persistence**: DSH `storage-domain` over the JSON backend at `$DSH_HOME/storages/dsh_smart_memory`.
- **Safety**: project isolation, sensitive-value redaction, audit log, and DSH `ctx.approval` for high-impact deletions.

## Install

### From a release (recommended)

1. Download `dsh-smart-memory-1.0.0.tgz` from [Releases](https://github.com/Ruiwang66/dsh-smart-memory/releases).
2. In DSH Desktop: **Settings → Plugins → Add plugin** and select the tarball (or install `file:/absolute/path/dsh-smart-memory-1.0.0.tgz`).
3. Enable `dsh-smart-memory` and restart DSH.
4. Open **Settings → Smart Memory**.

### From source

```sh
git clone https://github.com/Ruiwang66/dsh-smart-memory.git
cd dsh-smart-memory
npm ci
npm pack          # prepack builds first and produces dsh-smart-memory-1.0.0.tgz
```

Then install the tarball as in step 2 above.

### CLI profile

```sh
dsh plugin --profile <name> add file:/absolute/path/dsh-smart-memory-1.0.0.tgz
```

The `desktop` profile is owned by the Electron app; use the Desktop plugin manager instead of the CLI.

## Architecture

```text
src/host/index.ts        Cordis entry: domain, tools, dynamic recall, session feed, maintenance
src/host/store.ts        storage-domain persistence + index + dedupe/merge/conflict/versioning
src/host/project.ts      DSH Workspace → Git root → config root → registered path → cwd
src/host/retrieval.ts    BM25 + CJK n-gram retrieval and prompt budget
src/host/extraction.ts   async queue, LLM summarization, rule fallback, retries
src/host/tools.ts        11 tools, project isolation, approval, audit
src/host/rpc.ts          /api/smart-memory/* browser API
src/client/index.js      settings page (native settings.section slot, React)
```

Project identity is a hash of the canonical absolute path, never the folder name. Two same-named projects in different locations are different projects; project A's private memories are never recalled in project B.

## Data and privacy

- Data stays under `$DSH_HOME/storages/dsh_smart_memory`.
- No cloud embedding or external vector database.
- Automatic summarization sends the redacted conversation excerpt to the model provider already configured in DSH. Turning off **Auto summarize** switches to local rules only.
- The auxiliary extraction request is recorded in the plugin's `jobs` table, not the Session log, because external DSH plugins cannot declare a `SessionEventMap` record. This is an explicit limitation; turn off LLM summarization if strict session-log reconstruction is required.

## Development

```sh
npm ci
npm test          # build + full test suite
npm run build
npm pack
```

CI runs the same `npm test` on Node.js 22 and 24 — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml). The real-installation and authenticated-API verification record is in [VERIFICATION.md](VERIFICATION.md); contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).

Tests cover Chinese retrieval, same-name project isolation, Git/config root detection, redaction, rule extraction, persistence/merge/conflict/versioning, all 11 tools, session-event enqueueing, dynamic recall, HTTP API and client rendering.

## License

[MIT](LICENSE)
