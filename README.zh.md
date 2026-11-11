# DSH Smart Memory · 智能记忆

[![CI](https://github.com/Ruiwang66/dsh-smart-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruiwang66/dsh-smart-memory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4c6ef5.svg)](https://github.com/Ruiwang66/dsh-smart-memory/releases)

**中文** | [English](README.md)

为 **DeepSeek Harness 0.2.2-rc.1** 开发的原生长期记忆插件。它让 DSH 像 ChatGPT Memory 一样，自动记住用户的长期偏好、语言习惯、工作方式和纠正，同时为每个项目维护严格隔离的项目记忆。

> 目标版本：`dsh-smart-memory@1.0.0`  
> 已验证 DSH：`0.2.2-rc.1`（`engines.dsh: >=0.2.1-rc.3 <0.3.0`）  
> 运行时：Node.js >= 22

## 中英文双语

插件管理页会跟随 DSH 界面语言显示：

- 中文界面：`locale/zh.json` → 标题“智能记忆”，并展示 `README.zh.md`。
- English UI: `locale/en.json` → “Smart Memory”, and `README.md` is shown.

记忆管理页面本身以中文为主；如果需要全英文管理界面，可以在后续版本增加语言切换。

## 功能

- **双层记忆**：用户全局记忆跨会话、跨项目共享；项目记忆只属于当前项目。
- **自动记忆**：在每轮对话结束后异步提取长期信息，不阻塞正常对话；支持失败重试、任务去重、崩溃恢复。
- **自动召回**：通过 DSH 原生 `ctx.systemPrompt.section()` 在每个模型步骤动态注入相关记忆，不修改聊天历史或系统配置。
- **中文混合检索**：结合 BM25、中文字符 unigram/bigram、标签、重要度、固定状态和时间衰减进行排序；检索在本地完成，不依赖云端 Embedding 服务。
- **11 个模型工具**：`memory_search`、`memory_save`、`memory_update`、`memory_delete`、`memory_list`、`memory_pin`、`memory_unpin`、`memory_stats`、`memory_export`、`memory_import`、`memory_forget`。
- **完整管理界面**：设置 → 智能记忆，包含概览、全局记忆、项目记忆、自动记忆设置；中文界面，支持搜索、新增、编辑、删除、固定、锁定、导出、导入、清空。
- **原生持久化**：使用 DSH `storage-domain` + JSON 后端，数据位于 `$DSH_HOME/storages/dsh_smart_memory`，不写入会话日志。
- **安全边界**：项目记忆按规范化绝对路径隔离；敏感信息过滤；高风险删除/清空使用 DSH 审批服务（`ctx.approval`）请求用户一次性批准。

## 安装

> DSH 的「添加插件」是一个**文本输入框**，不是文件选择器，填的是包名、GitHub 仓库地址或本地路径（tarball 也要写成 `file:` 路径）。

### 方式一：本地 tgz（推荐，不需要联网构建）

1. 在 [Releases](https://github.com/Ruiwang66/dsh-smart-memory/releases) 下载 `dsh-smart-memory-1.0.0.tgz`。
2. 在 DSH Desktop：**设置 → 插件 → 添加插件**，输入框里填：

   ```
   file:C:\path\to\dsh-smart-memory-1.0.0.tgz
   ```

3. 点「安装」→ 启用 `dsh-smart-memory` → 重启 DSH（宿主插件需要重启；仅客户端页面可刷新加载）。
4. 打开 **设置 → 智能记忆**。

### 方式二：直接填 GitHub 仓库地址

在同一个输入框里填：

```
https://github.com/Ruiwang66/dsh-smart-memory
```

安装时会拉取源码并执行 `npm run build`（`prepare` 脚本），因此需要能访问 GitHub 与 npm registry。网络受限时请改用方式一。

### 方式三：从源码打包

```sh
git clone https://github.com/Ruiwang66/dsh-smart-memory.git
cd dsh-smart-memory
npm ci
npm pack          # prepack 会先构建，产出 dsh-smart-memory-1.0.0.tgz
```

然后按方式一的第 2 步安装。

### CLI profile

```sh
dsh plugin --profile <name> add file:/absolute/path/dsh-smart-memory-1.0.0.tgz
```

> `desktop` profile 由 Electron 应用独占，不能直接用 CLI 修改；请使用桌面端插件管理器。

## 架构

```text
src/host/index.ts        Cordis 插件入口：领域打开、工具、动态召回、会话事件、维护定时器
src/host/store.ts        storage-domain 持久化 + 内存索引 + 去重/合并/冲突/版本
src/host/project.ts      项目识别：DSH Workspace → Git root → 配置根 → 已登记路径 → cwd
src/host/retrieval.ts    BM25 + 中文 n-gram 混合检索与上下文预算
src/host/extraction.ts   异步提取队列、LLM 总结、规则回退、重试/恢复
src/host/tools.ts        11 个模型工具、项目隔离、审批、审计
src/host/rpc.ts          /api/smart-memory/* 浏览器 API
src/client/index.js      设置页 UI（原生 settings.section 槽位，React，无第三方 UI 库）
```

### 项目识别优先级

1. 当前 DSH Workspace 根目录（精确匹配）
2. Git 仓库根目录
3. 最近的 `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` 等项目配置根
4. 已登记的项目路径映射（最长前缀）
5. 当前工作目录

项目 ID 由**规范化绝对路径**哈希生成，不使用文件夹名称。因此不同位置的同名项目会得到不同 ID，项目 A 的记忆不会在项目 B 中召回。

### 自动提取

- 监听 `session/event`：`turn/start`、`user/message`、`assistant/message`、`turn/end`。
- 仅把人类 `source.kind === 'user'` 的消息作为对话输入；子代理会话不自动提取。
- `turn/end` 时把本轮摘要写入 `jobs` 表，异步队列在 1.8 秒后处理；每 15 秒扫描到期任务。
- 优先使用当前会话的 `agent.model.current()`，其次使用 `agentDefaultModel.currentSelection()`，通过 `ctx.llm.stream()` 调用模型；不硬编码 API 地址或 Key。
- 模型不可用或多次失败后使用保守规则回退，保证重要信息不会因一次模型故障完全丢失。
- 去重、合并、冲突和版本历史在 `store.ts` 中完成；冲突策略可在界面中配置。

### 自动召回

每个模型步骤调用动态 system prompt section。它读取当前 Agent 的 `session.header.cwd`，只选择全局记忆 + 当前项目记忆；按查询、重要度、固定、置信度和时间排序，并按配置的 Token 预算截断。没有相关记忆时不注入任何文本。

## 模型工具

| 工具 | 说明 |
|---|---|
| `memory_search` | 搜索全局 + 当前项目记忆 |
| `memory_save` | 保存全局或当前项目记忆 |
| `memory_update` | 更新标题、内容、分类、标签、重要度、固定、锁定、状态 |
| `memory_delete` | 删除单条；固定/锁定记忆请求用户批准 |
| `memory_list` | 分页列出记忆 |
| `memory_pin` / `memory_unpin` | 固定/取消固定 |
| `memory_stats` | 统计与队列状态 |
| `memory_export` | 导出 JSON（工具只能导出全局 + 当前项目） |
| `memory_import` | 导入 JSON；replace 模式需要确认和批准 |
| `memory_forget` | 按范围清除；始终请求用户批准 |

所有工具都执行参数校验、归属范围校验、错误处理和审计记录。项目工具无法通过猜测 `projectId` 读取其他项目。

## 设置

界面设置持久化在 `storage-domain` 中，并立即生效：

- 全局自动记忆 / 项目自动记忆
- 自动总结（关闭后使用规则提取）
- 自动召回
- 冲突处理策略：自动合并、以最新为准、保留双方、等待确认
- 每次召回数量（1–30）
- 上下文 Token 预算（200–8000）
- 敏感信息过滤
- 自动归档天数（0 为关闭）
- 忽略目录/文件规则（支持 `*`）

## 数据与隐私

- 数据保存在本机 `$DSH_HOME/storages/dsh_smart_memory`。
- 不依赖云端 Embedding 或外部向量库。
- 自动总结会把经过敏感信息过滤的对话片段发送到**当前 DSH 配置的模型提供方**；如果关闭“自动总结”，则只使用本地规则。
- 自动提取请求是插件自己的辅助模型请求，不属于用户会话；其输入/输出保存在插件 `jobs` 表中，而不是会话日志。这是当前 DSH 外部插件不能声明 `SessionEventMap` 记录带来的限制，已在 README 中明确记录。

## 已知限制

- **辅助模型请求不进入会话日志**：DSH 要求模型可见输入可从会话日志重建；外部插件不能声明 session event，因此本插件把提取请求记录在自有 `jobs` 表。若需要严格的会话日志重建，请关闭“自动总结”，仅使用规则提取。
- **中文检索是本地词法检索**：BM25 + 字符 n-gram 对中文短查询有效，但不等于语义向量检索；未引入 SQLite FTS5，以避免额外原生依赖。
- **项目路径变化**：项目 ID 绑定规范化路径；移动目录会被视为新项目，旧记忆保留在旧项目下。
- **子代理不自动提取**：避免同一对话被多个 Agent 重复总结。
- **UI 使用 `settings.section`**：需要 DSH 0.2.2-rc.1 的官方设置槽位；更早版本可能只注册工具与召回，不显示页面。
- **重启**：宿主插件安装/更新后需要重启 DSH；客户端页面刷新即可加载新 bundle。

## 开发与验证

```sh
npm ci
npm test          # 构建 + 10 个核心测试 + 4 个插件集成测试 + 1 个 LLM 提取测试 + 3 个双语元数据测试 + 2 个客户端渲染测试 + 1 个 jsdom 交互测试
npm run build
npm pack
```

CI 在 Node.js 22 与 24 上运行同一套 `npm test`，见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。真机安装与真实 API 验证记录在 [VERIFICATION.md](VERIFICATION.md)，贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

测试覆盖：

- 中文 tokenizer / BM25
- 同名不同路径项目隔离
- Git root / 配置根 / 已登记路径识别
- 敏感信息过滤
- 规则提取（只用用户侧文本提取全局偏好）
- 召回时为当前项目预留槽位
- 存储持久化、去重、冲突、固定、锁定、版本、导入导出
- 11 个工具注册、项目隔离、会话事件入队、动态召回
- LLM 总结 JSON 解析与全局/项目写入
- 双语元数据与 README 选择（中文 `locale/zh.json` → `README.zh.md`；英文 `locale/en.json` → `README.md`）
- HTTP API
- 客户端 bundle 自注册、首屏渲染、Tab 切换与 API 数据加载

## License

[MIT](LICENSE)
