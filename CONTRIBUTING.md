# Contributing

感谢你愿意改进 DSH Smart Memory。下面是参与开发前需要知道的几件事。

## 环境要求

- Node.js >= 22
- npm >= 10
- 用于真机验证的 DeepSeek Harness Desktop（当前验证版本 `0.2.2-rc.1`）

## 本地开发

```sh
npm install
npm run build     # TypeScript 宿主侧 + 客户端 bundle → lib/
npm test          # 构建后运行全部测试
```

`lib/` 是构建产物，不提交到仓库；`npm pack` 时会通过 `prepack` 自动构建。

## 目录约定

| 路径 | 说明 |
|---|---|
| `src/host/` | 宿主侧 TypeScript 源码（Cordis 插件、存储、检索、提取、工具、RPC） |
| `src/client/index.js` | 设置页 UI，原生 JS，通过 `window.__ModuleLoader__.load` 自注册 |
| `tests/` | `node:test` 测试，覆盖核心逻辑、插件集成、客户端渲染与交互 |
| `locale/` | 插件页双语元数据 |
| `scripts/` | 构建脚本 |

## 提交前检查

1. `npm test` 全绿。
2. 涉及插件清单（`package.json` 的 `dsh` 字段、`cordis.patch.yml`、`locale/*.json`）的改动，请同步更新 `tests/locale.test.mjs` 或相关断言。
3. 不要把 `lib/`、`node_modules/`、`*.tgz`、任何密钥或个人路径提交进仓库。
4. 面向用户的变更请补一条 `CHANGELOG.md` 记录。

## 提交信息

使用祈使句、简洁描述改动本身，例如：

```text
fix: keep project slot when recall budget is tight
feat: add archive days setting
docs: clarify session-log limitation
```

## 行为准则

保持技术讨论就事论事；不接受任何形式的骚扰、歧视或人身攻击。

## 许可

提交贡献即表示你同意以 [MIT](LICENSE) 许可发布这些代码。
