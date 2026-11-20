# 开发与发布 · Development and publishing

[简体中文](#简体中文) · [English](#english)

## 简体中文

### 开发和验证

在独立桥接器仓库的根目录运行以下命令。`npm test` 和 `npm pack` 都会编译 TypeScript，用户安装的是编译后的 JavaScript。

```powershell
npm ci
npm run check
npm test
npm pack
```

### 桥接器实现和扩展验收

- `bin/cli.mjs` 按命令加载 `dist/`。`src/mcp.ts` 装配 `src/tools/` 的连接、编排、执行和数据工具，后者由 `forwarded.ts` 转发到扩展。工具说明为中文，工具名、参数名和状态标识在两种语言中一致。
- 浏览器通过 Native Messaging 启动宿主。MCP 客户端启动单独的 stdio 进程，两者通过当前 Windows 用户的命名管道和每次会话的令牌通信。默认登记目录是 `%LOCALAPPDATA%\Jtcrpa\McpBridge`。`src/install.ts`、`src/connections.ts` 和 `src/registration-lock.ts` 负责登记、绑定和并发更新。浏览器关闭后仍可发现 MCP 工具，并可查询离线状态。
- 原生消息帧最大为 512 KiB，单次业务结果最大为 256 KiB。`page_probe` 支持页面快照、子帧查询、元素/提取探测、点击和滚动。`run_get` 最多列 20 次运行，每次最多读取 50 条日志，默认 10 条。`dataset_list` 默认每页 20 项，最多 50 项。
- 写请求用 UUID 标识。遇到 `OUTCOME_UNKNOWN` 时先查询原请求。扩展最多保留 1,024 条写请求凭据，共 2 MiB。`MCP` 连接断开后，正在运行的工作流由扩展继续管理。
- 扩展仓库与此仓库并列检出时，可在扩展仓库根目录运行下面的命令，对实际分发包进行隔离安装和真实浏览器验收。本例使用 0.4.1。正式发包使用已验收的同一份 `.tgz`。

```powershell
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --install-only
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --isolated-host
```

### 发布到 npm

推送与 `package.json` 版本对应的 Git 标签（例如版本 `0.4.2` 对应 `v0.4.2`），会触发 `.github/workflows/publish.yml`。Windows 构建任务安装锁文件中的依赖，运行类型检查、测试并生成 npm 安装包。独立的发布任务取得同一份包，发布后对照 npm 返回的 SHA-512 校验值。重复运行时，如线上已经存在同版本且校验值相同，验证通过即可结束。

首次使用 GitHub Actions 发布**新版本**前，由 npm 包维护者在 `jtcrpa-mcp` 的设置中添加 GitHub Actions 受信发布者，填写仓库所有者、仓库名和工作流文件名 `publish.yml`，并允许 `npm publish`。当前工作流没有指定 GitHub Environment，对应字段留空。也可以在支持 `npm trust` 的 npm CLI 中运行下面的命令并按提示验证。

```powershell
npm trust github jtcrpa-mcp --repo zhulinjia/jtcrpa-mcp-bridge --file publish.yml --allow-publish --registry=https://registry.npmjs.org
```

在下个版本准备发布时建立信任。npm 要求新绑定在两天内首次成功发布，核对已上线版本的校验值不会验证新绑定。绑定后，工作流使用 GitHub 提供的短期身份完成发布。[npm 可信发布](https://docs.npmjs.com/trusted-publishers/)

## English

### Development and verification

Run these commands in the root of the standalone bridge repository. Both `npm test` and `npm pack` compile TypeScript. The npm package ships the compiled JavaScript.

```powershell
npm ci
npm run check
npm test
npm pack
```

### Bridge internals and extension acceptance tests

- `bin/cli.mjs` loads commands from `dist/`. `src/mcp.ts` assembles the connection, authoring, execution and dataset tools in `src/tools/`. `forwarded.ts` relays tool calls to the extension. Tool descriptions are in Chinese. Tool names, argument names and status identifiers are shared by both guides.
- The browser starts the native host through Native Messaging. The MCP client starts a separate stdio process. They communicate through a Windows named pipe restricted to the current user, with a token for each session. Registrations default to `%LOCALAPPDATA%\Jtcrpa\McpBridge`. `src/install.ts`, `src/connections.ts` and `src/registration-lock.ts` manage registrations, bindings and concurrent updates. Tool discovery and offline status queries work while the browser is closed.
- Native frames are limited to 512 KiB, and individual tool results to 256 KiB. `page_probe` supports snapshots, frame queries, element and extraction probes, clicks and scrolling. `run_get` lists at most 20 runs and reads up to 50 log entries, with 10 entries by default. `dataset_list` defaults to 20 items per page and allows up to 50.
- Writes carry a request UUID. Query the original request after `OUTCOME_UNKNOWN`. The extension keeps up to 1,024 write-request records totalling 2 MiB. The extension continues to manage active workflows if the MCP connection drops.
- With the extension and bridge repositories checked out side by side, run the following from the extension repository to test the actual archive in an isolated installation and in real browsers. The example uses version 0.4.1. Publish the same `.tgz` that passed acceptance.

```powershell
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --install-only
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --isolated-host
```

### Publish to npm

Push a Git tag matching the version in `package.json` (for example `v0.4.2` for version `0.4.2`) to trigger `.github/workflows/publish.yml`. The Windows build job installs the locked dependencies, runs type checking and tests, then packs the project. A separate job publishes that archive and verifies the SHA-512 integrity reported by npm. A rerun accepts an existing version only when its integrity matches the built archive.

Before the first **new version** is published from GitHub Actions, an npm package maintainer must add a GitHub Actions trusted publisher in the settings for `jtcrpa-mcp`. Enter the repository owner and name, the filename `publish.yml`, and allow `npm publish`. Leave the GitHub Environment field empty for this workflow. With an npm CLI that supports `npm trust`, you can also run the following and complete the verification prompt.

```powershell
npm trust github jtcrpa-mcp --repo zhulinjia/jtcrpa-mcp-bridge --file publish.yml --allow-publish --registry=https://registry.npmjs.org
```

Set up trust when the next version is ready. npm requires the first successful publish within two days of creating a trusted publisher. Checking the integrity of an existing release does not validate a new binding. Once bound, the workflow authenticates using the short-lived identity issued by GitHub. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
