# 九头虫 MCP 本机桥接器（jtcrpa-mcp）

本仓库维护 npm 包 `jtcrpa-mcp`，通过 Native Messaging 连接九头虫浏览器插件，并向 Codex 等 MCP 客户端提供工作流编排、执行和数据集读取能力。运行需要 Node.js 20.19.0 或更高版本、Windows PowerShell 5.1 和已安装的九头虫插件。新安装建议选择仍受官方维护的 Node.js LTS。

插件代码在 `agent-jtcrpa-com` 仓库。插件与桥接器独立打包和发布，通过本机通信协议配合。一起检出时，插件仓库位于 `../agent-jtcrpa-com`。

## 代码组织

- `src/mcp.ts`：静态导入 MCP 依赖，创建服务并依次装配各组工具。
- `src/tools/forwarded.ts`：业务工具注册、扩展请求转发、错误判定与 MCP 返回格式转换，各自分为独立函数。
- `src/tools/connection.ts`：连接状态与回声工具，保留各自的离线返回处理。
- `src/tools/authoring.ts`：页面上下文、编排契约、探针与工作流查询 / 保存定义。
- `src/tools/execution.ts`：启动、运行查询与运行控制定义。
- `src/tools/datasets.ts`：数据集元数据查询与分页读取定义。
- `src/tools/definition.ts`：转发工具的类型契约；只读及外部副作用属性由每个定义明确声明。
- `src/connection-cli.ts` 提供连接列表和交互删除。`src/connections.ts` 保存稳定编号、目标和浏览器握手确认过的实例。`src/install.ts` 同步登记与宿主清单，`src/registration-lock.ts` 串行处理当前用户的变更。
- `src/native-host-registry.ts`：Chrome / Firefox 原生宿主注册表路径及查询、注册、删除与尽力恢复操作；查询使用 `windows/read-registration.ps1` 返回 UTF-8 JSON，保留中文路径。

CLI 在命令入口按需装配对应模块；MCP 模块内部使用静态导入。工具定义拆分不改变对外名称、描述、参数 Schema、属性及返回处理。

源码使用 TypeScript；`npm run build` 输出 `dist/` 中的 JavaScript，并将本地导入改为 `.js`。CLI 只加载 `dist/`；`npm pack` / 发布前通过 prepack 自动编译，安装包包含 `bin/`、`dist/` 和 `windows/`，使用者不需要 TypeScript 编译器。不要将直接运行源码或 npm link 的结果当作实际安装包的验收结果。

工具描述统一使用中文，工具名、参数名和状态标识保留协议原名。

MCP 编排完整复用插件原 `system_prompt.md`，只补取 Schema 时用 `includeGuide: false`。通过 MCP 编排或修改保存成功后，AI 必须说明保存结果、询问是否现在执行，并等待本次保存后的用户确认；成功返回中的 `nextAction.type=confirm_execution` 表达这个交接。用户直接要求运行已有流程时按该指令调用，无须重新编排。此交接只适用于 MCP，不改变共享提示词或插件内置 AI 流程，也不是后台认证用户回复的授权凭据。

## 工具能力

编排工具：`browser_context` 选择明确标签页；`workflow_contract` 读取现有编译说明和按需节点/探针 Schema；`page_probe` 提供 snapshot、queryFrames、probeElement、probeExtract、probeClick、probeScroll；`workflow_list` / `workflow_get` 查询；`workflow_save` 复用原提交校验并保存。暂未适配网络、文件、飞书等探针，不能把相关前置能力视为已验证。当前仅通过 Codex 验收，Claude Code 与 DeepSeek Harness 保留配置生成支持。

执行工具：`workflow_run` 按明确 workflowId / tabId 启动用户工作流，返回 runId；`run_get` 按 runId 查询真实状态和日志摘要，省略 runId 时列最近记录，可按 workflowId 收窄；`run_control` 暂停、恢复或结束。运行与控制同样需要 UUID requestId，复用下述结果凭据。运行授权与编排保存分开，先确认用户要运行再调用；返回 runId 表示已建档，ok 不代表已完成。暂停时在途页面动作可能完成；结束不撤销已经发生的副作用，终态保持 FAILED / run:aborted。

`run_get` 最多列最近 20 次运行、最近 50 条日志（默认 10 条；logLimit=0 跳过日志加载），只返回摘要，不返回变量、工作流整树、日志参数或 result 原文。状态和日志是实时数据，可能来自不同读取时点；需要完整错误细节时到插件日志页查看。MCP 断开不结束运行，未知启动结果先查请求编号和最近运行，不自动重新启动。

数据工具：`dataset_list` 按关键词分页查询元数据（默认每页 20 项、最多 50 项）；`dataset_read` 按真实 datasetId 或 datasetName 精确读取，两个标识必须且只能提供一个。页码从 1 起，默认每页 50 行、最多 200 行，可通过 fields 选择字段。沿用正式列和字符串投影，不返回内部 id / _hash；空页、未找到与存储异常分别返回。结果标记 consistency:live，不保证并发采集时的冻结快照。

用户已明确：使用自己的 AI 读取自己的数据，不检查会员、导出额度等权限。数据读取没有套餐门槛；原有导出下载规则保持现有行为。单次数据响应限制 256 KiB，超限明确报错，按提示减小 pageSize 或 fields，不截断记录。元数据列表不包含样例行或上传文件的原始表头内容。

`connection_status` 可带 `requestId` 查询写请求结果。保存、点击/滚动探针需 UUID 格式的 requestId；同 ID 同参数返回已知结果，参数不同拒绝，未完成凭据返回 `OUTCOME_UNKNOWN`。超时或取消不等于未执行，不自动换 ID 重试。凭据位于扩展的 `mcp-write-requests`，保留至显式归档，不自动过期；最多 1024 条、2 MiB（为单条结果预留 256 KiB），满时拒绝新写入。本期未提供归档界面，不应通过清空凭据规避未知状态。跨崩溃不保证业务恰好执行一次。编辑遵循原 upsert 语义，检查返回的 updated 与 workflowId。

Native 信封上限 512 KiB，业务结果预算 256 KiB，按 UTF-8 计量；超限明确报错，不静默裁切。探针最长可等待 30 秒，原生宿主等待 45 秒，IPC 等待 50 秒。客户端更早超时后，可用原 requestId 查询保存结果。

## 本地安装

在 Windows PowerShell 中从 npm 全局安装桥接器。

```powershell
npm.cmd install --global jtcrpa-mcp
```

本地测试时，也可以安装从源码生成的压缩包。

```powershell
npm.cmd pack
npm.cmd install --global .\jtcrpa-mcp-0.4.1.tgz
```

首次从源码打包前，按下方开发步骤运行 `npm ci`。

在插件设置菜单打开「MCP 连接」，复制本浏览器的注册命令并运行。例如：

```powershell
jtcrpa-mcp.cmd add --chrome-id <真实Chrome扩展ID>
jtcrpa-mcp.cmd add --firefox-id 379522770@qq.com
```

首次添加会为当前 Windows 用户注册本机宿主。同一浏览器的多个扩展 ID 可以分别添加，重复执行同一条命令会复用已有授权。已有连接可以继续使用。请从稳定的安装目录运行命令。移动包或更换 Node 路径后，关闭 MCP 连接，重新执行对应的 `jtcrpa-mcp add` 命令以更新启动器。

开启扩展的 MCP 连接后，可以在 PowerShell 管理登记。浏览器关闭后仍能查到记录。

```powershell
jtcrpa-mcp.cmd list
jtcrpa-mcp.cmd add --chrome-id <扩展ID> --instance <列表中的UUID>
jtcrpa-mcp.cmd remove
```

`list` 显示完整扩展 ID、已确认的浏览器实例 UUID 和在线状态。使用 `add --instance` 为待选登记指定目标，首次选择沿用原编号。对同一目标重复添加会复用该编号，同一扩展下的另一个实例会获得独立编号。Firefox 使用 `--firefox-id`。运行 `remove` 后按序号选择并确认。

用列表编号为客户端生成配置。例如，以下命令生成绑定当前登记 `c1` 的 Codex 配置。客户端使用生成的绑定 UUID。删除登记后旧配置失效，重新安装时可以重新使用显示编号。

```powershell
jtcrpa-mcp.cmd config --connection c1 --client codex
```

从旧测试包升级时，原先手填 `mcp --connection c1` 的客户端需要重新生成一次配置。

脚本可用 `list --json` 读取登记，用 `remove c1` 删除指定记录。需要换扩展或换已选实例时，先添加新连接，将客户端指向新编号，再删除旧登记。也可用扩展页面的命令直接连接指定的浏览器实例。

```powershell
cmd.exe /d /c codex mcp add jtcrpa -- cmd.exe /d /c jtcrpa-mcp mcp --instance <页面显示的实例ID>
```

需要终端已能运行 `codex` 和 npm 全局命令 `jtcrpa-mcp`；命令直接保存 Codex 配置，无需手动编辑 TOML。成功后重新连接 MCP 或重启 Codex，在聊天中发送「检查九头虫 MCP 连接，并列出当前浏览器标签页。」确认可用。该命令固定服务名为 `jtcrpa`，配置多个实例时应改用不同服务名。

其它客户端或需要自行管理配置时，仍可生成配置：

```powershell
jtcrpa-mcp.cmd config --instance <页面显示的实例ID>
```

命令返回 Codex 的 TOML、Claude Code 的 MCP JSON，以及 DeepSeek Harness 的 MCP 插件配置。配置使用当前 Node 和包入口的绝对路径；DeepSeek 部分加到其插件列表中。每个浏览器配置使用独立实例 ID。多个实例需要在客户端使用不同的 MCP 服务名；浏览器关闭时返回离线，连接不会自动切换到其它实例。复制浏览器配置造成实例冲突时，可在插件页显式生成新实例 ID，再更新客户端配置。

## 卸载

关闭所有浏览器配置中的 MCP 开关，再运行：

```powershell
jtcrpa-mcp.cmd uninstall
```

只清理指向本安装目录的注册，保留其它原生宿主。随后可运行 `npm uninstall --global jtcrpa-mcp` 移除全局包。开发用 npm link 按其安装方式移除。原地更新包后，新进程会加载新版。安装目录默认 `%LOCALAPPDATA%\Jtcrpa\McpBridge`，`JTCRPA_BRIDGE_HOME` 仅供隔离验收指定独立目录。

若开发命令提示找不到 `dist/*.js`，先在源码目录运行 `npm run build`。若全局包提示不支持在 node_modules 中移除类型，说明仍在使用直接加载 `.ts` 的旧安装包，应重新打包并安装含 `dist/` 的版本。

注册查询和启动器均支持 UTF-8 中文路径。移动全局目录或更换 Node 路径后，使用绝对路径接入的 AI 客户端也需更新其配置。

## 通信边界

MCP stdio 由官方 SDK 实现。浏览器原生宿主与 MCP 进程是两个 Node 进程；前者通过随包的 Windows PowerShell 脚本创建管道。管道显式仅授权当前用户并拒绝 Network SID，发现目录也限制当前用户访问；每次宿主会话另有随机认证令牌。令牌不会返回给 MCP 工具。此信任范围包含当前系统用户的本地进程。

消息上限为 512 KiB，工具输入按白名单校验。浏览器离线不阻塞 MCP 初始化和工具发现。断开不执行任何业务重放。协议版本或同时在线的实例 ID 冲突会明确报错。`list` 通过本机管道确认浏览器是否在线，并保留已登记的离线实例。

## 开发与发包

在桥接器仓库根目录运行以下命令。

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd pack
```

`npm test` 和 `npm pack` 都会先编译。`npm pack` 生成 `jtcrpa-mcp-<版本>.tgz`。确认验收后，可以将同一份 `.tgz` 作为 `npm publish` 的输入。开发时可用 `npm link`，源码更新后运行 `npm run build` 刷新 CLI 加载的 `dist/`。

在插件仓库根目录用生成的 `.tgz` 验证真实安装。下例对应两个仓库并列检出且桥接器版本为 `0.4.1`。

```powershell
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --install-only
node tests/mcp-package/run.mjs ../jtcrpa-mcp-bridge/jtcrpa-mcp-0.4.1.tgz --isolated-host
```

`--install-only` 验证受限 PowerShell 的全局安装、连接管理和官方 SDK 离线调用。`--isolated-host` 还会用独立的 Windows 注册表宿主名、临时浏览器配置和同一份安装包验证升级、卸载、Chrome / Firefox 在线工具与数据读取。专用 Windows 测试帐户可省略参数，验证正式宿主名。完整入口和报告位置见插件仓库的 `docs/2026-11-06-mcp-package-acceptance.md`。
