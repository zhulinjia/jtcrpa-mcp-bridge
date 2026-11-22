# 九头虫 MCP 使用指南 · Jiutouchong MCP User Guide

[简体中文](#简体中文) · [English](#english)

## 简体中文

[从安装到读出第一张表](../README.md#首次连接) · [已有连接，直接跟做书店练习](../README.md#第一次用-mcp-采集书名和价格)

### 客户端配置

在目标浏览器的 **MCP 连接** 页开启连接并允许本机通信，复制页面上的 `connect` 命令，在本机终端执行。桥接器注册宿主，核验接入凭据，把这份浏览器配置绑定到稳定的服务名和实例。

插件页的 **复制 MCP 配置** 和终端输出提供同一份 JSON。可将它交给 AI，请它在支持本机 stdio 的客户端添加该服务，保留现有服务。接受 `mcpServers` 的客户端可直接合并该条目。其他配置格式沿用生成的服务名、`command` 和完整的 `args` 数组。路径属于运行桥接器的这台电脑。配置生效后，可让 AI 用九头虫读取当前页面，或调用 `connection_ping` 核对实例。

macOS 上，Google Chrome 和 Microsoft Edge 都使用 `--chrome-id`。运行中的浏览器只有一个用户数据根目录时，`connect` 使用该目录；有多个候选目录时，桥接器按扩展 ID 区分。也可在 `add` 或 `connect` 末尾加 `--chrome-user-data-dir "/绝对路径/用户数据目录"`。在目标浏览器打开 `chrome://version` 或 `edge://version`，使用「个人资料路径」上一级、含 `Local State` 的目录。开发工具重新创建临时目录后，从新实例再次运行接入命令。

### 书店示例的工具调用

下面对应首页三条聊天消息。使用者在聊天框说需求，AI 客户端向 `jtcrpa` 调用工具。想核对客户端做到了哪一步，可以对照表里的返回值。

| 操作 | 客户端传给 MCP 的工具和参数 | 用什么判断成功 |
| --- | --- | --- |
| 1. 打开目标网址 | 调用 `page_open`，传书店网址 `url` 和 UUID `requestId`。用户指定已有页时可用 `browser_context`。 | 从同一浏览器服务取得实际网址、`tabId` 和 `pageRef`。 |
| 2. 看页面，试采一行 | 调用 `workflow_contract`，传 `{"nodeTools":["emitExtractNode"],"probeTools":["snapshot","probeExtract"]}`。用上一步的 `tabId` 和 `pageRef` 调用 `page_probe`，先用 `tool: "snapshot"`，然后用 `tool: "probeExtract"`，`params` 包含书籍卡片的 `selectors` 和两列的 `steps`。 | 快照包含书名。首页的 `totalMatched` 为 4，`sample` 只预览前 2 行的 `title` 和 `price`。 |
| 3. 保存并核对规则 | `workflow_save` 传 `tabId`、`pageRef`、新生成的 UUID `requestId` 和完整的 `workflow` 对象。可直接使用下方的书店规则。接着将返回的 `workflowId` 传给 `workflow_get`。 | 首次保存返回 `ok: true`、`updated: false` 和 `workflowId`。核对规则指向 `bookshop_demo`。`nextAction.type` 为 `confirm_execution`，此处等待用户单独确认。 |
| 4. 启动并等到结束 | 用户确认后，`workflow_run` 传已保存的 `workflowId`、目标 `tabId`、`pageRef` 和这次运行的新 UUID `requestId`。把返回的 `runId` 传给 `run_get`，可加 `logLimit: 3` 查看最近日志。 | `runId` 用于追踪这一次运行。等到 `run.status` 为 `SUCCESS`，本例的 `run.savedRows` 为 4。遇到 `FAILED` 可查看同一响应里的 `logs`。 |
| 5. 读取真正落库的行 | `dataset_list` 传 `{"query":"bookshop_demo"}`。核对 `datasets` 里的 `datasetName`、`fields`、`rowsCount`。再用 `dataset_read` 传精确的 `datasetName` 或用查到的 `id` 作 `datasetId`。 | 首次运行且数据集原来为空时，`total` 为 4，`rows` 中有《山海之间》和 ¥32.00。 |

保存后标签页保留。用户明确要求关闭具体页面时，AI 才调用 `page_close`，传回该页的 `tabId`、`pageRef`、新的 `requestId` 和 `userRequested: true`。页面跳转后从同一服务重新取得引用。

编写接口采集工作流时，通过 `workflow_contract` 查询 `networkCatalog`、`networkSnapshot` 和 `probeNetwork` 是否可用，再用同一页的 `tabId` 和 `pageRef` 调用 `page_probe`。三者分别列出已捕获接口、查看结构和样例、预检取数和清洗。省略 `frameId` 或传 0。能力缺失时同时检查扩展和桥接器版本。

预览本地文件时，在目标浏览器的「九头虫 → MCP 连接 → 本地文件预览」选定一份文件，复制引用发给 AI。客户端通过 `file_describe({fileRef})` 取得字段和少量样例，CSV 和 Excel 可以追加 `hasHeader` 复核首行。引用十分钟内有效，换选文件或撤回会使原引用失效。

示例文件是 `workflow_save` 的 **workflow 参数**。它包含可通过校验的完整步骤。要重现试采，取第一个节点的 `selectors` 和 `steps` 作为 `probeExtract` 的 `params`。标签页编号和页面引用由 `page_open` 或 `browser_context` 提供，写请求的 UUID 由客户端生成。[查看完整书店规则 JSON](examples/bookshop-workflow.json)

想核对自己客户端发出的请求时，可以从读取结果开始。下面是 MCP `tools/call` 的 `params`，在数据集已写入后即可使用。

```json
{
  "name": "dataset_read",
  "arguments": {
    "datasetName": "bookshop_demo",
    "page": 1,
    "pageSize": 4,
    "fields": ["title", "price"]
  }
}
```

### 使用工作流和数据集

| 你在聊天中可以这样说 | MCP 会怎么做 |
| --- | --- |
| 「我在书店搜好了这次的关键词，用已保存的 Bookshop demo 采当前结果页。」 | 你在书店输入任意关键词并点击搜索，然后在聊天中确认结果页已打开。`workflow_list` 按名称找已有规则，`browser_context` 定位实际结果页，`workflow_run` 在该页执行。同一规则可以用于不同关键词。 |
| 「给 Bookshop demo 增加详情页网址列，先展示试采结果，再保存。」 | `workflow_get` 读取原规则，`page_probe` 验证书名链接的 `href`。更新时，`workflow_save.workflow.workflowId` 使用原编号。核对说明与使用方法后保存，再请你确认要不要执行。 |
| 「暂停刚才那次运行。」或「继续刚才暂停的运行。」 | `run_control` 带该次 `runId`、新 UUID 及 `action`（`pause` 或 `resume`）。明确要求结束时使用 `abort`。`run_get` 可核对结果。暂停时正在执行的页面动作仍可能完成，结束会保留已经写入的数据。 |
| 「只看已存数据。读 bookshop_demo 第 2 页，每页 4 行，只显示 title 和 price。」 | `dataset_read` 传 `page: 2`、`pageSize: 4` 与指定列。完成首页和第 2 页两次采集后，数据集共 8 行。`run.savedRows` 只统计单次运行。 |

`dataset_read` 只接受 `datasetId`、`datasetName` 中的一个，页码从 1 开始，默认每页 50 行、最多 200 行。根据 `hasNext` 和 `nextPage` 继续翻页。运行中读取的是当时的数据。单次响应上限 256 KiB，超限时减小 `pageSize` 或减少 `fields`。

### 管理多个浏览器配置

每份浏览器配置有自己的 MCP 服务名，例如 Chromium 系浏览器连接 `c2` 的默认名称为 `jtcrpa_chrome_c2`。重复接入沿用原名与绑定。合并时若客户端已有同名条目指向其他浏览器，可为新条目换名。以下命令按编号管理连接。

```sh
jtcrpa-mcp list
jtcrpa-mcp list --json
```

看到「待选择实例」时，在目标浏览器开启 **MCP 连接**，执行插件页显示的接入命令。

手动管理旧配置或其他客户端时，可以运行列表给出的 `add ... --instance ...` 命令，再用实际登记编号生成配置。例如，为 Claude Code 导出 `c1` 的配置可以运行下面的命令。

```sh
jtcrpa-mcp config --connection c1 --client claude
```

可选客户端为 `codex`、`claude`、`deepseek`，省略 `--client` 会输出三种配置。生成的启动参数包含登记的绑定 UUID。更换已选实例或扩展时，先添加新连接、更新客户端配置，再运行 `jtcrpa-mcp remove` 选择旧登记并确认。脚本可用 `jtcrpa-mcp remove c1` 直接删除指定登记。删除后，即使显示编号被复用，旧配置也会返回 `CONNECTION_REMOVED`。

### 排查连接问题

| 现象 | 处理 |
| --- | --- |
| 在侧边栏底部的设置菜单找不到「MCP 连接」 | 确认装的是九头虫 Agent。Chrome 和 Firefox 商店发布的 `2.0.2` 缺少此功能。如果已从官方取得支持 MCP 的 Chrome 压缩包，解压后在 `chrome://extensions` 打开「开发者模式」，点「加载已解压的扩展程序」并选择含 `manifest.json` 的目录。打开这份扩展的 MCP 页面，复制它自己的注册命令。[联系九头虫](https://jtcrpa.com/contact) |
| 旧 Codex 对话仍连接另一份浏览器配置 | 先在目标浏览器完成接入。已有对话如果还没加载新的服务，可以在方便时重新打开 Codex，让它读取新配置。 |
| 能收到回声却找不到书店标签页 | 把书店网址发给 AI，请它用九头虫的 `page_open` 打开。书店会在绑定的浏览器中打开。 |
| 已有 `runId`，聊天里没有任何行 | 用 `run_get` 查本次状态和 `savedRows`。失败时看最近日志。成功但写入 0 行时，检查目标标签页及抽取节点的 `dataset_name`，并重新试采。已有写入却找不到列时，先让 AI 用 `dataset_list` 核对数据集名称和 `fields`。 |
| 写入请求超时 | 把原 `requestId` 传给 `connection_status` 核对请求状态。启动请求还可用 `run_get` 按 `workflowId` 查最近运行，再决定是否重试。 |
| PowerShell 提示「禁止运行脚本」（`.ps1`） | 把当前命令开头的 `npm` 换成 `npm.cmd`，或把 `jtcrpa-mcp` 换成 `jtcrpa-mcp.cmd`，参数照写。例如 `jtcrpa-mcp.cmd list`。 |
| 终端找不到 `jtcrpa-mcp` | 运行 `npm prefix -g` 查看全局命令目录。macOS 的命令目录是该路径下的 `bin`。确认命令目录已加入 `PATH`，重新打开终端后用 `jtcrpa-mcp --version` 检查。 |
| npm 镜像提示找不到刚发布的包 | 直接从官方源安装，运行 `npm install --global jtcrpa-mcp --registry=https://registry.npmjs.org`。 |
| `Access to the specified native messaging host is forbidden` | 从当前扩展的 MCP 页面重新复制注册命令，对照 `list` 的完整扩展 ID，运行命令后重新开启 MCP。开发版扩展换 ID 后也要登记新 ID。 |
| 首次授权后接口尚未就绪 | 等待正在运行或暂停的工作流结束，保存并关闭编辑页。扩展会自动重载一次。若仍提示手动重载，在扩展管理页重新加载。 |
| `BROWSER_OFFLINE` 或绑定已变更 | 在目标浏览器开启 MCP。若本机宿主缺失，页面会显示重新登记的命令。若绑定已变更，请按上方「管理多个浏览器配置」更新客户端配置。 |
| `CONNECTION_INSTANCE_NOT_SELECTED` 或 `CONNECTION_REMOVED` | 前者按 `list` 的提示选择实例。后者从现有登记重新生成客户端配置。 |

### 升级和卸载

在原位置升级时，关闭 MCP 连接，运行 `npm install --global jtcrpa-mcp@latest`，再开启连接。移动 npm 全局目录或 Node.js 后，重跑当前扩展的注册命令。使用绝对路径的客户端配置也要重新生成。

卸载前先关闭所有浏览器配置的 MCP 开关，再依次运行以下命令。第一条清理本安装的宿主登记和连接，第二条移除 npm 全局包。

```sh
jtcrpa-mcp uninstall
npm uninstall --global jtcrpa-mcp
```

## English

[Go from installation to your first table](../README.md#first-time-setup) · [Already connected? Start the bookshop exercise](../README.md#collect-your-first-four-books)

### Client configuration

In the target browser profile, enable **MCP connection**, allow native messaging, then copy and run the full `connect` command in a local terminal. The bridge registers the native host and verifies the setup ticket and instance.

Click **Copy MCP configuration** and ask your AI to add this service to its local stdio client settings. The terminal prints the same JSON. Clients accepting `mcpServers` can merge the entry directly. For other formats, use its service name, `command` and complete `args` array. The paths refer to this machine. Once the client loads the configuration, ask it to read the current page or call `connection_ping` to confirm the instance.

On macOS, Google Chrome and Microsoft Edge both use `--chrome-id`. When the running browsers have a single user data root, `connect` uses it. With multiple roots, the bridge looks for the extension ID. To select a root explicitly, append `--chrome-user-data-dir "/absolute/path/to/user data"` to `add` or `connect`. Open `chrome://version` or `edge://version` in the target browser and use the parent of the Profile Path containing `Local State`. Run setup again when the development tool creates a new temporary directory.

### Tool calls for the bookshop example

These are the calls behind the three chat messages in the README. Enter the prompts in chat. Your AI client sends the tool calls to `jtcrpa`. Use the results below to see how far it got.

| Action | Tool and arguments sent by the client | What to check |
| --- | --- | --- |
| 1. Open the target URL | Call `page_open` with the bookshop `url` and a UUID `requestId`. Use `browser_context` when the user identifies an existing tab. | Take the actual URL, `tabId` and `pageRef` from the same bound browser service. |
| 2. Inspect the page and preview a row | Call `workflow_contract` with `{"nodeTools":["emitExtractNode"],"probeTools":["snapshot","probeExtract"]}`. Use the returned `tabId` and `pageRef` for both `page_probe` calls. Start with `tool: "snapshot"`, then use `tool: "probeExtract"` with the card `selectors` and two column `steps` in `params`. | The snapshot contains a book title. On the homepage `totalMatched` is 4. The `sample` preview shows `title` and `price` for just the first two rows. |
| 3. Save and check the rule | Pass `tabId`, `pageRef`, a fresh UUID `requestId` and the full `workflow` object to `workflow_save`. The linked bookshop rule supplies that object. Call `workflow_get` with the returned `workflowId`. | A new workflow returns `ok: true`, `updated: false` and its `workflowId`. Check the output dataset is `bookshop_demo`. With `nextAction.type` equal to `confirm_execution`, wait for a separate user confirmation. |
| 4. Start and wait for completion | After confirmation, call `workflow_run` with that `workflowId`, the target `tabId` and `pageRef` and a new UUID for this run’s `requestId`. Pass the returned `runId` to `run_get`. Add `logLimit: 3` for recent logs. | Use `runId` to follow this run. Wait for `run.status` to reach `SUCCESS`. In this example `run.savedRows` is 4. If it reaches `FAILED`, read the `logs` in the same response. |
| 5. Read the stored rows | Send `{"query":"bookshop_demo"}` to `dataset_list`. Check `datasetName`, `fields` and `rowsCount` in `datasets`. Call `dataset_read` with the exact `datasetName`, or pass the returned `id` as `datasetId`. | After the first run on an empty dataset, `total` is 4 and `rows` includes *Between Mountains and Seas* at ¥32.00. |

Saving leaves the tab open. When the user explicitly asks to close a specific page, call `page_close` with its `tabId`, `pageRef`, a fresh `requestId` and `userRequested: true`. After navigation, refresh the page reference from the same service.

For network extraction workflows, check `workflow_contract` for `networkCatalog`, `networkSnapshot`, and `probeNetwork`. Call them through `page_probe` with the same `tabId` and `pageRef`. They list captured endpoints, show response structure and samples, and preview extraction and cleaning. Omit `frameId` or set it to 0. Check both the extension and bridge versions if any probe is unavailable.

To preview a local file, select one file under **Jiutouchong → MCP connection → Local file preview** in the target browser. Copy the reference into your AI chat. The client calls `file_describe({fileRef})` to get fields and a few sample rows. For CSV and Excel, pass `hasHeader` to check the first row again. The reference lasts ten minutes and expires when you select another file or revoke the preview.

The example file is the complete **workflow argument** for `workflow_save`. To reproduce the preview, take `selectors` and `steps` from its first node and pass them as the `params` of `probeExtract`. Get the tab ID and page reference from `page_open` or `browser_context` and generate write-request UUIDs in the client. [View the complete bookshop workflow JSON](examples/bookshop-workflow.json)

To check what your own client sends after it has saved the data, start with this `params` object for MCP `tools/call`.

```json
{
  "name": "dataset_read",
  "arguments": {
    "datasetName": "bookshop_demo",
    "page": 1,
    "pageSize": 4,
    "fields": ["title", "price"]
  }
}
```

### Work with workflows and datasets

| What you can ask in chat | What the MCP client does |
| --- | --- |
| “I’ve searched the bookshop for my keyword. Run my saved Bookshop demo on the results page.” | Enter any search term in the bookshop and click **Search**, then send the message. `workflow_list` finds the saved rule by name, `browser_context` identifies the open results tab and `workflow_run` runs it there. The same rule works with different terms. |
| “Add a details URL column to Bookshop demo. Preview it, then save the change.” | `workflow_get` loads the original and `page_probe` checks the title link’s `href`. Pass the original ID as `workflow_save.workflow.workflowId`. After reviewing the description and instructions, save the change and wait for confirmation to run. |
| “Pause the run you just started.” or “Resume that paused run.” | `run_control` takes this `runId`, a new request UUID and the `pause` or `resume` action. Use `abort` when the user asks to stop. Check the result with `run_get`. An in-flight page action may finish after a pause. Stopping preserves data already written. |
| “Read page 2 of the stored bookshop_demo dataset, four rows per page. Show only title and price.” | `dataset_read` takes `page: 2`, `pageSize: 4` and the chosen fields. After collecting both bookshop pages, the dataset contains eight rows. `run.savedRows` counts only the rows written by that particular run. |

Supply exactly one of `datasetId` or `datasetName` to `dataset_read`. Pages start at 1, with 50 rows by default and at most 200 per page. Follow `hasNext` and `nextPage` to keep reading. While a run is active, each read reflects the data at that moment. If the response exceeds 256 KiB, reduce `pageSize` or select fewer `fields`.

### Manage multiple browser profiles

Each browser profile has a separate service name, such as `jtcrpa_chrome_c2`. Reconnecting preserves the binding and name. When adding the JSON to a client, choose a different name if an existing entry already targets another browser. Manage connections by number with the following commands.

```sh
jtcrpa-mcp list
jtcrpa-mcp list --json
```

If the list shows `待选择实例` (select an instance), enable **MCP connection** in the intended profile and run the setup command shown there.

For manual configuration of older setups or other clients, use the `add ... --instance ...` command from the list, then generate a configuration with the registered number. For example, this command exports the Claude Code configuration for `c1`.

```sh
jtcrpa-mcp config --connection c1 --client claude
```

The supported client identifiers are `codex`, `claude` and `deepseek`. Omit `--client` to print all three configurations. The generated startup arguments contain the registration’s binding UUID. To switch to a different extension ID or selected instance, add the new connection, update the client, then run `jtcrpa-mcp remove` to select and confirm the old registration. In scripts, `jtcrpa-mcp remove c1` removes the specified entry directly. The old client configuration returns `CONNECTION_REMOVED` even if its display number is later reused.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| MCP connection is missing from the sidebar’s Settings menu | Check the extension name is Jiutouchong Agent. The Chrome and Firefox store releases of `2.0.2` lack this feature. If you received an MCP-enabled Chrome ZIP from Jiutouchong, extract it, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the folder containing `manifest.json`. Open that extension’s MCP page and copy its own registration command. [Contact Jiutouchong](https://jtcrpa.com/en/contact) |
| An old Codex session still uses another profile | Register the intended profile. If your current session has not loaded the new server, reopen Codex when convenient to load the configuration. |
| The echo works, but the bookshop tab is missing | Give the assistant the URL and ask it to open the page with Jiutouchong’s `page_open` in the bound browser. |
| You have a `runId` but see no rows | Use `run_get` to check the run’s status and `savedRows`. Read recent logs on failure. For a successful run with zero writes, check the tab and the extraction node’s `dataset_name`, then preview the extraction again. If rows were saved but a column is missing, use `dataset_list` to check the dataset name and `fields`. |
| A write request timed out | Pass its original `requestId` to `connection_status` to inspect the request. For a start request, also query recent runs with `run_get` filtered by `workflowId` before retrying. |
| PowerShell says running scripts is disabled (`.ps1`) | Replace `npm` with `npm.cmd`, or `jtcrpa-mcp` with `jtcrpa-mcp.cmd`, at the start of the command. Keep the same arguments, for example `jtcrpa-mcp.cmd list`. |
| The terminal cannot find `jtcrpa-mcp` | Run `npm prefix -g` to locate the global command directory. On macOS the executables are in its `bin` subdirectory. Check that the executable directory is on your `PATH`, reopen the terminal and run `jtcrpa-mcp --version`. |
| An npm mirror cannot find a newly published version | Install from the public registry with `npm install --global jtcrpa-mcp --registry=https://registry.npmjs.org`. |
| `Access to the specified native messaging host is forbidden` | Copy the registration command from the current extension, check its complete ID against `list`, run the command and turn MCP on again. Register the new ID if a development build’s extension ID has changed. |
| Native messaging is unavailable immediately after granting permission | Save open edits and let active or paused workflows finish. The extension will reload once. If it still requests a manual reload, use the browser’s extensions page. |
| `BROWSER_OFFLINE` or the binding changed | Enable MCP in the target browser. If native host registration is missing, the page shows the registration command. If the binding changed, update the client configuration using the connection management steps above. |
| `CONNECTION_INSTANCE_NOT_SELECTED` or `CONNECTION_REMOVED` | For the first error, select a target using the instruction from `list`. For the second, generate a fresh client configuration from an existing registration. |

### Upgrade or uninstall

For an in-place upgrade, turn MCP off, run `npm install --global jtcrpa-mcp@latest` and reconnect. If Node.js or the npm global directory moves, rerun the registration command from the extension. Regenerate client configurations that refer to the previous absolute paths.

To uninstall, first disable MCP in all connected browser profiles. The first command below removes this installation’s native host registrations and connections. The second removes the global npm package.

```sh
jtcrpa-mcp uninstall
npm uninstall --global jtcrpa-mcp
```
