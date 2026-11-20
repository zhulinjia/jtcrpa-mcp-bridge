# 九头虫 MCP 桥接器 · Jiutouchong MCP Bridge

[简体中文](#简体中文) · [English](#english)

## 简体中文

`jtcrpa-mcp` 让 MCP 客户端连接这台 Windows 电脑上的九头虫浏览器扩展。连接后，你可以让 AI 查看指定浏览器的标签页、创建和运行工作流、检查日志，或读取采集到的数据。

### 安装并连接第一个浏览器

1. 准备原生 Windows、Windows PowerShell 5.1、Node.js **20.19.0 或更高版本**，以及装有九头虫扩展的 Chrome 或 Firefox 配置。使用 Codex 的用户还需要能在终端运行 `codex`。在 PowerShell 中安装桥接器并检查版本。

   ```powershell
   npm.cmd install --global jtcrpa-mcp
   jtcrpa-mcp.cmd --version
   ```

2. 在要连接的浏览器中打开九头虫的**设置 → MCP 连接**。复制**注册当前浏览器**下的整条命令，在 PowerShell 中运行。页面会填好当前扩展 ID，Chrome 使用 `add --chrome-id`，Firefox 使用 `add --firefox-id`。首次运行会为当前 Windows 用户注册本机宿主。
3. 在同一页面打开**开启 MCP 连接**，按浏览器提示允许本机通信。状态变为**浏览器与本机程序已连接**后，在**接入外部 AI**中选择客户端。

   | 客户端 | 在哪里使用页面生成的命令或配置 |
   | --- | --- |
   | Codex | 在 PowerShell 中执行页面给出的 `codex mcp add` 完整命令。它会保存名为 `jtcrpa` 的服务。重新连接 MCP 或重启 Codex。 |
   | Claude Code | 在 PowerShell 中执行页面给出的 `config` 命令，将输出的 `mcpServers.jtcrpa` 合并到项目的 `.mcp.json`。重启客户端，在 `/mcp` 查看。 |
   | DeepSeek Harness | 在 PowerShell 中执行页面给出的 `config` 命令，把输出的插件条目加入 Harness 的插件列表，然后重启客户端。 |

4. 在客户端发送 **“检查九头虫 MCP 连接，并列出当前浏览器标签页。”** 对照浏览器中打开的标签页即可确认连到了正确的配置。Codex 已在 Chrome 和 Firefox 上完成端到端验收。Claude Code 和 DeepSeek Harness 提供配置生成，尚未完成同等的端到端验收。

安装、注册和客户端接入通常只做一次。保持该浏览器配置的 MCP 开关开启，浏览器会按需启动本机宿主。日常使用时打开目标浏览器即可。

### 使用工作流和数据集

| 用途 | MCP 工具 | 示例 |
| --- | --- | --- |
| 确认连接、读取页面 | `connection_status`、`connection_ping`、`browser_context`、`page_probe` | “列出当前标签页，查看所选商品列表页能提取哪些字段。” |
| 查找或编排工作流 | `workflow_list`、`workflow_get`、`workflow_contract`、`workflow_save` | “把当前页面的商品名称和价格采集规则保存为工作流。” |
| 执行并检查结果 | `workflow_run`、`run_get`、`run_control` | “在当前列表页运行刚才的工作流，再告诉我状态和最近日志。” |
| 读取采集数据 | `dataset_list`、`dataset_read` | “找到商品数据集，读取前 20 行，只返回商品名称和价格。” |

保存新工作流或修改已有工作流后，客户端应等你确认再执行。启动返回 `runId`，用 `run_get` 查询完成状态。写操作超时后，先用原 UUID 请求编号查询 `connection_status`，再核对最近运行。暂停可能仍有在途动作，结束运行不会撤销已执行的操作。

`dataset_read` 按 `datasetId` 或 `datasetName` 精确读取，两者任选其一。页码从 1 开始，默认每页 50 行、最多 200 行，`fields` 可指定字段。采集仍在进行时，翻页读到的是当时的数据。单次结果上限为 256 KiB，超限时请减小页大小或减少字段。

### 管理多个浏览器配置

直接使用扩展页面生成的接入命令时，客户端绑定该浏览器配置的实例 UUID。需要同时接入多个配置时，为每个实例设置不同的 MCP 服务名。要通过登记编号管理连接，可在 PowerShell 运行以下命令。

```powershell
jtcrpa-mcp.cmd list
jtcrpa-mcp.cmd list --json
```

如果列表显示「待选择实例」，确认目标浏览器已开启 MCP，然后执行列表给出的 `add ... --instance ...` 命令。相同扩展 ID 的多个浏览器配置可以分别选择。选定后，用实际编号替换下面示例中的 `c1`。

```powershell
jtcrpa-mcp.cmd config --connection c1 --client codex
```

可选客户端为 `codex`、`claude`、`deepseek`，省略 `--client` 会输出三种配置。生成的启动参数包含登记的绑定 UUID。更换已选实例或扩展时，先添加新连接、更新客户端配置，再运行 `jtcrpa-mcp.cmd remove` 选择旧登记并确认。脚本可用 `jtcrpa-mcp.cmd remove c1` 直接删除指定登记。删除后，即使显示编号被复用，旧配置也会返回 `CONNECTION_REMOVED`。

### 排查连接问题

| 现象 | 处理 |
| --- | --- |
| PowerShell 提示禁止运行脚本，或找不到命令 | 使用上面的 `npm.cmd` 和 `jtcrpa-mcp.cmd`。用 `npm.cmd prefix --global` 查看 Windows 全局命令目录，并确认它在当前终端的 `PATH` 中。 |
| npm 镜像提示找不到刚发布的包 | 直接从官方源安装，运行 `npm.cmd install --global jtcrpa-mcp --registry=https://registry.npmjs.org`。 |
| `Access to the specified native messaging host is forbidden` | 从当前扩展的 MCP 页面重新复制注册命令，对照 `list` 的完整扩展 ID，运行命令后重新开启 MCP。开发版扩展换 ID 后也要登记新 ID。 |
| 「本机通信接口尚未就绪」或提示需要权限 | 在浏览器扩展管理页重新加载九头虫，返回 MCP 页面开启连接，按提示允许本机通信。 |
| `BROWSER_OFFLINE` 或标签页属于另一个浏览器 | 打开目标浏览器配置并开启 MCP，核对页面的实例 UUID 与客户端配置。复制浏览器配置造成实例冲突时，使用扩展页面的「生成新实例 ID」并更新该客户端配置。 |
| `CONNECTION_INSTANCE_NOT_SELECTED` 或 `CONNECTION_REMOVED` | 前者按 `list` 的提示选择实例。后者从现有登记重新生成客户端配置。 |

### 升级和卸载

在原位置升级时，关闭 MCP 连接，运行 `npm.cmd install --global jtcrpa-mcp@latest`，再开启连接。移动 npm 全局目录或 Node.js 后，重跑当前扩展的注册命令。使用绝对路径的客户端配置也要重新生成。

卸载前先关闭所有浏览器配置的 MCP 开关，再依次运行以下命令。第一条清理本安装的宿主登记和连接，第二条移除 npm 全局包。

```powershell
jtcrpa-mcp.cmd uninstall
npm.cmd uninstall --global jtcrpa-mcp
```

### 开发和验证

在独立桥接器仓库的根目录运行以下命令。`npm test` 和 `npm pack` 都会编译 TypeScript，用户安装的是编译后的 JavaScript。与扩展的端到端验收方法见下方的「[维护者参考](#维护者参考)」。

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd pack
```

## English

`jtcrpa-mcp` connects an MCP client to the Jiutouchong browser extension on your Windows computer. Use it to inspect tabs in a chosen browser profile, create and run workflows, check run logs, or read collected data.

### Connect your first browser

1. Use native Windows with Windows PowerShell 5.1, **Node.js 20.19.0 or later**, and the Jiutouchong extension installed in a Chrome or Firefox profile. For Codex, the `codex` command must also be available in your terminal. Install the bridge and check its version in PowerShell.

   ```powershell
   npm.cmd install --global jtcrpa-mcp
   jtcrpa-mcp.cmd --version
   ```

2. In the browser profile you want to use, open the extension’s **Settings → MCP connection**. Copy the entire command under **Register this browser** and run it in PowerShell. The extension fills in its own ID. Chrome uses `add --chrome-id` and Firefox uses `add --firefox-id`. The first registration installs the native host for the current Windows user.
3. Turn on **Enable MCP connection** on that page and grant native messaging permission when prompted. Once the page shows **Browser connected to the local program**, choose your client under **Connect an AI app**.

   | Client | How to use the command or configuration from the extension |
   | --- | --- |
   | Codex | Run the full `codex mcp add` command in PowerShell. It saves a service named `jtcrpa`. Reconnect the MCP client or restart Codex. |
   | Claude Code | Run the generated `config` command in PowerShell. Merge the resulting `mcpServers.jtcrpa` entry into the project’s `.mcp.json`, restart Claude Code and check `/mcp`. |
   | DeepSeek Harness | Run the generated `config` command in PowerShell, add the resulting plugin entry to the Harness plugin list and restart the client. |

4. Ask your client **“Check the Jiutouchong MCP connection and list the tabs in the connected browser.”** Match the returned tabs to the ones open in your target profile. Codex has been tested end to end with both Chrome and Firefox. Configuration generation is available for Claude Code and DeepSeek Harness. An equivalent end-to-end test for these two clients is pending.

Setup is normally a one-time operation. Leave MCP enabled in the target profile. The browser starts the native host on demand when you open that profile.

### Work with workflows and datasets

| Task | MCP tools | Example request |
| --- | --- | --- |
| Check the connection and inspect a page | `connection_status`, `connection_ping`, `browser_context`, `page_probe` | “List the tabs and check which fields can be extracted from the selected product listing.” |
| Find or create a workflow | `workflow_list`, `workflow_get`, `workflow_contract`, `workflow_save` | “Save a workflow that collects product names and prices from this page.” |
| Run a workflow and check the result | `workflow_run`, `run_get`, `run_control` | “Run that saved workflow on this listing and show its status and recent logs.” |
| Read collected data | `dataset_list`, `dataset_read` | “Find the product dataset and show the first 20 rows with just names and prices.” |

After saving a new or edited workflow, the client should wait for your confirmation before running it. Starting a workflow returns a `runId`. Use `run_get` to check whether it finished. If a write times out, query `connection_status` with the original request UUID and check recent runs before retrying. An action already in progress can finish after a pause. Stopping a run does not undo actions it has already taken.

For `dataset_read`, supply exactly one of `datasetId` and `datasetName`. Pages start at 1, with 50 rows by default and a maximum of 200. Use `fields` to select columns. Pages reflect live data if collection is still running. If a result exceeds 256 KiB, request fewer rows or columns.

### Manage multiple browser profiles

The setup command from the extension binds the client to the instance UUID of that browser profile. Give each instance its own MCP service name when connecting several profiles. To manage connections by their registration number, run the following in PowerShell.

```powershell
jtcrpa-mcp.cmd list
jtcrpa-mcp.cmd list --json
```

If the list shows `待选择实例` (select an instance), enable MCP in the intended profile and run the `add ... --instance ...` command shown in the list. Profiles with the same extension ID can be selected separately. After selecting a target, substitute its connection number for `c1` in this example.

```powershell
jtcrpa-mcp.cmd config --connection c1 --client codex
```

The supported client identifiers are `codex`, `claude` and `deepseek`. Omit `--client` to print all three configurations. The generated startup arguments contain the registration’s binding UUID. To switch to a different extension ID or selected instance, add the new connection, update the client, then run `jtcrpa-mcp.cmd remove` to select and confirm the old registration. In scripts, `jtcrpa-mcp.cmd remove c1` removes the specified entry directly. The old client configuration returns `CONNECTION_REMOVED` even if its display number is later reused.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| PowerShell reports that scripts are disabled, or cannot find the command | Use `npm.cmd` and `jtcrpa-mcp.cmd` as shown above. Check the Windows global command directory with `npm.cmd prefix --global` and ensure it is on the current terminal’s `PATH`. |
| An npm mirror cannot find a newly published version | Install from the public registry with `npm.cmd install --global jtcrpa-mcp --registry=https://registry.npmjs.org`. |
| `Access to the specified native messaging host is forbidden` | Copy the registration command from the current extension, check its complete ID against `list`, run the command and turn MCP on again. Register the new ID if a development build’s extension ID has changed. |
| The native messaging interface is unavailable, or the browser requests permission | Reload Jiutouchong from the browser’s extensions page, enable the connection again and allow native messaging when prompted. |
| `BROWSER_OFFLINE` or tabs from the wrong browser | Open the target profile, enable MCP and compare its instance UUID with the client configuration. If a copied profile produces an instance conflict, use the extension’s option to generate a new instance ID and update that client. |
| `CONNECTION_INSTANCE_NOT_SELECTED` or `CONNECTION_REMOVED` | For the first error, select a target using the instruction from `list`. For the second, generate a fresh client configuration from an existing registration. |

### Upgrade or uninstall

For an in-place upgrade, turn MCP off, run `npm.cmd install --global jtcrpa-mcp@latest` and reconnect. If Node.js or the npm global directory moves, rerun the registration command from the extension. Regenerate client configurations that refer to the previous absolute paths.

To uninstall, first disable MCP in all connected browser profiles. The first command below removes this installation’s native host registrations and connections. The second removes the global npm package.

```powershell
jtcrpa-mcp.cmd uninstall
npm.cmd uninstall --global jtcrpa-mcp
```

### Development and verification

Run these commands in the root of the standalone bridge repository. Both `npm test` and `npm pack` compile TypeScript. The npm package ships the compiled JavaScript. For extension integration tests, see the [maintainer reference](#maintainer-reference).

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd pack
```

## 维护者参考

- `bin/cli.mjs` 按命令加载 `dist/`。`src/mcp.ts` 装配 `src/tools/` 的连接、编排、执行和数据工具，后者由 `forwarded.ts` 转发到扩展。工具说明为中文，工具名、参数名和状态标识在两种语言中一致。
- 浏览器通过 Native Messaging 启动宿主。MCP 客户端启动单独的 stdio 进程，两者通过当前 Windows 用户的命名管道和每次会话的令牌通信。默认登记目录是 `%LOCALAPPDATA%\Jtcrpa\McpBridge`。`src/install.ts`、`src/connections.ts` 和 `src/registration-lock.ts` 负责登记、绑定和并发更新。浏览器关闭后仍可发现 MCP 工具，并可查询离线状态。
- 原生消息帧最大为 512 KiB，单次业务结果最大为 256 KiB。`page_probe` 支持页面快照、子帧查询、元素/提取探测、点击和滚动。`run_get` 最多列 20 次运行，每次最多读取 50 条日志，默认 10 条。`dataset_list` 默认每页 20 项，最多 50 项。
- 写请求用 UUID 标识。遇到 `OUTCOME_UNKNOWN` 时先查询原请求。扩展最多保留 1,024 条写请求凭据，共 2 MiB。`MCP` 连接断开后，正在运行的工作流由扩展继续管理。
- 扩展仓库与此仓库并列检出时，可在扩展仓库根目录运行下面的命令，对实际分发包进行隔离安装和真实浏览器验收。本例使用 0.4.1。正式发包使用已验收的同一份 `.tgz`。

```powershell
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --install-only
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --isolated-host
```

## Maintainer reference

- `bin/cli.mjs` loads commands from `dist/`. `src/mcp.ts` assembles the connection, authoring, execution and dataset tools in `src/tools/`. `forwarded.ts` relays tool calls to the extension. Tool descriptions are in Chinese. Tool names, argument names and status identifiers are shared by both guides.
- The browser starts the native host through Native Messaging. The MCP client starts a separate stdio process. They communicate through a Windows named pipe restricted to the current user, with a token for each session. Registrations default to `%LOCALAPPDATA%\Jtcrpa\McpBridge`. `src/install.ts`, `src/connections.ts` and `src/registration-lock.ts` manage registrations, bindings and concurrent updates. Tool discovery and offline status queries work while the browser is closed.
- Native frames are limited to 512 KiB, and individual tool results to 256 KiB. `page_probe` supports snapshots, frame queries, element and extraction probes, clicks and scrolling. `run_get` lists at most 20 runs and reads up to 50 log entries, with 10 entries by default. `dataset_list` defaults to 20 items per page and allows up to 50.
- Writes carry a request UUID. Query the original request after `OUTCOME_UNKNOWN`. The extension keeps up to 1,024 write-request records totalling 2 MiB. The extension continues to manage active workflows if the MCP connection drops.
- With the extension and bridge repositories checked out side by side, run the following from the extension repository to test the actual archive in an isolated installation and in real browsers. The example uses version 0.4.1. Publish the same `.tgz` that passed acceptance.

```powershell
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --install-only
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --isolated-host
```
