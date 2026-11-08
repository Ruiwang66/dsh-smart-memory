# Changelog

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-08

首个公开版本，面向 DeepSeek Harness `0.2.2-rc.1`。

### 新增

- **双层记忆**：全局用户记忆跨会话共享；项目记忆按规范化绝对路径严格隔离。
- **自动提取**：`turn/end` 后异步总结，持久化队列 + 重试 + 崩溃恢复；模型不可用时回退到本地规则提取。
- **自动召回**：通过 `ctx.systemPrompt.section()` 在每个模型步骤注入相关记忆，不修改聊天历史。
- **中文混合检索**：BM25 + CJK unigram/bigram + 标签 + 重要度 + 固定 + 时间衰减，纯本地运行。
- **11 个模型工具**：`memory_search`、`memory_save`、`memory_update`、`memory_delete`、`memory_list`、`memory_pin`、`memory_unpin`、`memory_stats`、`memory_export`、`memory_import`、`memory_forget`。
- **管理界面**：设置 → 智能记忆，包含概览、全局记忆、项目记忆与自动记忆设置。
- **原生持久化**：基于 DSH `storage-domain`，数据位于 `$DSH_HOME/storages/dsh_smart_memory`。
- **安全边界**：敏感信息过滤、审计日志、高风险删除/清空走 `ctx.approval` 一次性批准。
- **中英双语元数据**：`locale/zh.json` 与 `locale/en.json`，插件页跟随 DSH 界面语言。
- **浏览器 API**：`/api/smart-memory/*`（health / save / memories / pin / update / settings / overview / export / import / audit）。

### 验证

- 21 项自动化测试通过（核心 10 + 插件集成 4 + LLM 提取 1 + 双语元数据 3 + 客户端渲染 2 + jsdom 交互 1）。
- 在 DSH Desktop `0.2.2-rc.1` 上完成真实安装，宿主插件 `fiberPhase: active`。
- 在独立临时 profile 中通过真实认证 API 验证全部端点。详见 [VERIFICATION.md](VERIFICATION.md)。

### 已知限制

- 外部插件无法声明 `SessionEventMap`，自动提取的辅助模型请求记录在插件 `jobs` 表中，而非会话日志。
- 中文检索为本地词法检索，不是语义向量检索。
- 项目 ID 绑定规范化路径，移动目录会被视为新项目。
- 宿主插件安装/更新后需要重启 DSH。
