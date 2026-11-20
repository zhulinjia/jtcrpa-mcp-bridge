# 九头虫 MCP 使用指南 · Jiutouchong MCP User Guide

[简体中文](#简体中文) · [English](#english)

## 简体中文

[首次安装与连接](../README.md#简体中文)

### 客户端配置

浏览器连通后，在扩展的 **接入外部 AI** 中选择客户端。使用 Codex 时，应能在终端运行 `codex`。

| 客户端 | 在哪里使用页面生成的命令或配置 |
| --- | --- |
| Codex | 在 PowerShell 中执行页面给出的 `codex mcp add` 完整命令。它会保存名为 `jtcrpa` 的服务。重新连接 MCP 或重启 Codex。 |
| Claude Code | 在 PowerShell 中执行页面给出的 `config` 命令，将输出的 `mcpServers.jtcrpa` 合并到项目的 `.mcp.json`。重启客户端，在 `/mcp` 查看。 |
| DeepSeek Harness | 在 PowerShell 中执行页面给出的 `config` 命令，把输出的插件条目加入 Harness 的插件列表，然后重启客户端。 |

Codex 已在 Chrome 和 Firefox 上使用支持 MCP 的扩展版本完成端到端验收。Claude Code 和 DeepSeek Harness 提供配置生成，尚未完成同等的端到端验收。

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
jtcrpa-mcp list
jtcrpa-mcp list --json
```

如果列表显示「待选择实例」，确认目标浏览器已开启 MCP，然后执行列表给出的 `add ... --instance ...` 命令。相同扩展 ID 的多个浏览器配置可以分别选择。选定后，用实际编号替换下面示例中的 `c1`。

```powershell
jtcrpa-mcp config --connection c1 --client codex
```

可选客户端为 `codex`、`claude`、`deepseek`，省略 `--client` 会输出三种配置。生成的启动参数包含登记的绑定 UUID。更换已选实例或扩展时，先添加新连接、更新客户端配置，再运行 `jtcrpa-mcp remove` 选择旧登记并确认。脚本可用 `jtcrpa-mcp remove c1` 直接删除指定登记。删除后，即使显示编号被复用，旧配置也会返回 `CONNECTION_REMOVED`。

### 排查连接问题

| 现象 | 处理 |
| --- | --- |
| 扩展设置里找不到「MCP 连接」 | 到官网查看九头虫 Agent 更新。安装带有「MCP 连接」入口的扩展版本后，再运行注册命令。[九头虫 RPA 官网与扩展下载](https://jtcrpa.com/) |
| PowerShell 提示「禁止运行脚本」（`.ps1`） | 把当前命令开头的 `npm` 换成 `npm.cmd`，或把 `jtcrpa-mcp` 换成 `jtcrpa-mcp.cmd`，参数照写。例如 `jtcrpa-mcp.cmd list`。 |
| 终端找不到 `jtcrpa-mcp` | 运行 `npm prefix -g` 查看全局命令目录。确认该目录已加入 `PATH`，重新打开终端后用 `jtcrpa-mcp --version` 检查。 |
| npm 镜像提示找不到刚发布的包 | 直接从官方源安装，运行 `npm install --global jtcrpa-mcp --registry=https://registry.npmjs.org`。 |
| `Access to the specified native messaging host is forbidden` | 从当前扩展的 MCP 页面重新复制注册命令，对照 `list` 的完整扩展 ID，运行命令后重新开启 MCP。开发版扩展换 ID 后也要登记新 ID。 |
| 「本机通信接口尚未就绪」或提示需要权限 | 在浏览器扩展管理页重新加载九头虫，返回 MCP 页面开启连接，按提示允许本机通信。 |
| `BROWSER_OFFLINE` 或标签页属于另一个浏览器 | 打开目标浏览器配置并开启 MCP，核对页面的实例 UUID 与客户端配置。复制浏览器配置造成实例冲突时，使用扩展页面的「生成新实例 ID」并更新该客户端配置。 |
| `CONNECTION_INSTANCE_NOT_SELECTED` 或 `CONNECTION_REMOVED` | 前者按 `list` 的提示选择实例。后者从现有登记重新生成客户端配置。 |

### 升级和卸载

在原位置升级时，关闭 MCP 连接，运行 `npm install --global jtcrpa-mcp@latest`，再开启连接。移动 npm 全局目录或 Node.js 后，重跑当前扩展的注册命令。使用绝对路径的客户端配置也要重新生成。

卸载前先关闭所有浏览器配置的 MCP 开关，再依次运行以下命令。第一条清理本安装的宿主登记和连接，第二条移除 npm 全局包。

```powershell
jtcrpa-mcp uninstall
npm uninstall --global jtcrpa-mcp
```

## English

[First-time setup](../README.md#english)

### Client configuration

Once the browser is connected, choose your client under **Connect an AI app** in the extension. For Codex, make sure the `codex` command is available in your terminal.

| Client | How to use the command or configuration from the extension |
| --- | --- |
| Codex | Run the full `codex mcp add` command in PowerShell. It saves a service named `jtcrpa`. Reconnect the MCP client or restart Codex. |
| Claude Code | Run the generated `config` command in PowerShell. Merge the resulting `mcpServers.jtcrpa` entry into the project’s `.mcp.json`, restart Claude Code and check `/mcp`. |
| DeepSeek Harness | Run the generated `config` command in PowerShell, add the resulting plugin entry to the Harness plugin list and restart the client. |

Codex has been tested end to end with MCP-enabled extension builds on Chrome and Firefox. Configuration generation is available for Claude Code and DeepSeek Harness. Equivalent end-to-end testing for those two clients is pending.

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
jtcrpa-mcp list
jtcrpa-mcp list --json
```

If the list shows `待选择实例` (select an instance), enable MCP in the intended profile and run the `add ... --instance ...` command shown in the list. Profiles with the same extension ID can be selected separately. After selecting a target, substitute its connection number for `c1` in this example.

```powershell
jtcrpa-mcp config --connection c1 --client codex
```

The supported client identifiers are `codex`, `claude` and `deepseek`. Omit `--client` to print all three configurations. The generated startup arguments contain the registration’s binding UUID. To switch to a different extension ID or selected instance, add the new connection, update the client, then run `jtcrpa-mcp remove` to select and confirm the old registration. In scripts, `jtcrpa-mcp remove c1` removes the specified entry directly. The old client configuration returns `CONNECTION_REMOVED` even if its display number is later reused.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| MCP connection is missing from the extension settings | Check the official website for Jiutouchong Agent updates. Install a build that shows **MCP connection** in Settings, then run its registration command. [Official website and extension downloads](https://jtcrpa.com/en) |
| PowerShell says running scripts is disabled (`.ps1`) | Replace `npm` with `npm.cmd`, or `jtcrpa-mcp` with `jtcrpa-mcp.cmd`, at the start of the command. Keep the same arguments, for example `jtcrpa-mcp.cmd list`. |
| The terminal cannot find `jtcrpa-mcp` | Run `npm prefix -g` to locate the global command directory. Check that it is on your `PATH`, reopen the terminal and run `jtcrpa-mcp --version`. |
| An npm mirror cannot find a newly published version | Install from the public registry with `npm install --global jtcrpa-mcp --registry=https://registry.npmjs.org`. |
| `Access to the specified native messaging host is forbidden` | Copy the registration command from the current extension, check its complete ID against `list`, run the command and turn MCP on again. Register the new ID if a development build’s extension ID has changed. |
| The native messaging interface is unavailable, or the browser requests permission | Reload Jiutouchong from the browser’s extensions page, enable the connection again and allow native messaging when prompted. |
| `BROWSER_OFFLINE` or tabs from the wrong browser | Open the target profile, enable MCP and compare its instance UUID with the client configuration. If a copied profile produces an instance conflict, use the extension’s option to generate a new instance ID and update that client. |
| `CONNECTION_INSTANCE_NOT_SELECTED` or `CONNECTION_REMOVED` | For the first error, select a target using the instruction from `list`. For the second, generate a fresh client configuration from an existing registration. |

### Upgrade or uninstall

For an in-place upgrade, turn MCP off, run `npm install --global jtcrpa-mcp@latest` and reconnect. If Node.js or the npm global directory moves, rerun the registration command from the extension. Regenerate client configurations that refer to the previous absolute paths.

To uninstall, first disable MCP in all connected browser profiles. The first command below removes this installation’s native host registrations and connections. The second removes the global npm package.

```powershell
jtcrpa-mcp uninstall
npm uninstall --global jtcrpa-mcp
```
