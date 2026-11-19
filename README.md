# jtcrpa-mcp：九头虫 MCP 本地桥接

当前支持 Windows 本机连接、工作流编排、保存、执行及数据集读取。需要 Node.js 24+、Windows 自带 Windows PowerShell 5.1，以及浏览器中的九头虫扩展。

## 代码组织

- `src/mcp.ts`：静态导入 MCP 依赖，创建服务并依次装配各组工具。
- `src/tools/forwarded.ts`：业务工具注册、扩展请求转发、错误判定与 MCP 返回格式转换，各自分为独立函数。
- `src/tools/connection.ts`：连接状态与回声工具，保留各自的离线返回处理。
- `src/tools/authoring.ts`：页面上下文、编排契约、探针与工作流查询 / 保存定义。
- `src/tools/execution.ts`：启动、运行查询与运行控制定义。
- `src/tools/datasets.ts`：数据集元数据查询与分页读取定义。
- `src/tools/definition.ts`：转发工具的类型契约；只读及外部副作用属性由每个定义明确声明。
- `src/install.ts`：安装命令分发、独立的安装 / 卸载流程、参数解析、清单生成与文件备份恢复。
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

统一通过 npm 全局安装。包发布后，在 PowerShell 执行：

```powershell
npm install --global jtcrpa-mcp
```

当前包尚未发布到 npm，以上为发布后的正式安装命令。插件页面采用相同方案，不要求用户填写本地安装包路径。已有本地测试安装可继续使用；开发者在 `bridge/` 目录安装依赖并生成验收包：

```powershell
npm install --registry=https://registry.npmjs.org
npm run check
npm test
npm pack
```

`npm test` 会先编译，`npm pack` 也会重新编译后打包。开发时可在编译后使用 `npm link`；源码变更后先运行 `npm run build` 再调用命令，避免运行旧产物。

在插件设置菜单打开「MCP 连接」，复制本浏览器的注册命令并运行。例如：

```powershell
jtcrpa-mcp install --chrome-id <真实Chrome扩展ID>
jtcrpa-mcp install --firefox-id 379522770@qq.com
```

两条命令分别安装各浏览器白名单，可连续运行。当前用户注册，无需管理员；只接受明确扩展 ID。安装路径必须稳定，不要从临时 npx 缓存注册宿主。移动包、更新 Node 路径后需关闭插件 MCP 连接并重新执行 install。

开启页面连接开关并授予本机通信权限。Codex 用户可复制页面提供的接入命令，在 PowerShell 执行一次：

```powershell
codex mcp add jtcrpa -- cmd.exe /d /c jtcrpa-mcp mcp --instance <页面显示的实例ID>
```

需要终端已能运行 `codex` 和 npm 全局命令 `jtcrpa-mcp`；命令直接保存 Codex 配置，无需手动编辑 TOML。成功后重新连接 MCP 或重启 Codex，在聊天中发送「检查九头虫 MCP 连接，并列出当前浏览器标签页。」确认可用。该命令固定服务名为 `jtcrpa`，配置多个实例时应改用不同服务名。

其它客户端或需要自行管理配置时，仍可生成配置：

```powershell
jtcrpa-mcp instances
jtcrpa-mcp config --instance <页面显示的实例ID>
```

命令返回 Codex 的 TOML、Claude Code 的 MCP JSON，以及 DeepSeek Harness 的 MCP 插件配置。配置使用当前 Node 和包入口的绝对路径；DeepSeek 部分加到其插件列表中。每个浏览器配置使用独立实例 ID。多个实例需要在客户端使用不同的 MCP 服务名；浏览器关闭时返回离线，连接不会自动切换到其它实例。复制浏览器配置造成实例冲突时，可在插件页显式生成新实例 ID，再更新客户端配置。

## 卸载

关闭所有浏览器配置中的 MCP 开关，再运行：

```powershell
jtcrpa-mcp uninstall
```

只清理指向本安装目录的注册，保留其它原生宿主。随后可运行 `npm uninstall --global jtcrpa-mcp` 移除全局包；开发用 npm link 按其安装方式移除。更新包时先关闭全部 MCP 连接，安装新包，再重新执行各浏览器的注册命令；移动全局目录或切换 Node 后还应重新生成客户端配置。安装目录默认 `%LOCALAPPDATA%\Jtcrpa\McpBridge`，`JTCRPA_BRIDGE_HOME` 仅供隔离验收指定独立目录。

早期本地包名为 `@jtcrpa/mcp-bridge`、命令为 `jtcrpa-bridge`。切换名称前先关闭全部 MCP 连接，使用旧命令卸载宿主并按原安装方式移除旧包，再通过 npm 安装新包、注册浏览器并重新生成客户端配置。

若开发命令提示找不到 `dist/*.js`，先在源码目录运行 `npm run build`。若全局包提示不支持在 node_modules 中移除类型，说明仍在使用直接加载 `.ts` 的旧安装包，应重新打包并安装含 `dist/` 的版本。

含中文路径的注册查询与启动器均按 UTF-8 处理。更新旧安装后需重新执行注册命令，以刷新宿主启动器；仅更新 npm 包不会重写已有 host.cmd。

## 通信边界

MCP stdio 由官方 SDK 实现。浏览器原生宿主与 MCP 进程是两个 Node 进程；前者通过随包的 Windows PowerShell 脚本创建管道。管道显式仅授权当前用户并拒绝 Network SID，发现目录也限制当前用户访问；每次宿主会话另有随机认证令牌。令牌不会返回给 MCP 工具。此信任范围包含当前系统用户的本地进程。

消息上限为 512 KiB，工具输入按白名单校验。浏览器离线不阻塞 MCP 初始化和工具发现。断开不执行任何业务重放。协议版本或同时在线的实例 ID 冲突会明确报错。`instances` 只显示实例 ID 和进程存活状态，工具调用仍以实际通信结果为准。

## 验收

`node tests/mcp-package/run.mjs`（仓库根）执行实际 npm 包验收：打包、检查运行文件、在项目内隔离 npm prefix 全局安装，通过全局命令和生成的 Codex 配置检查入口，注册两端宿主，使用版本递增的隔离包验证更新与重新注册，再经安装包回归 Chrome / Firefox 的编排、保存、执行和数据读取，最后卸载宿主及隔离全局包。该测试使用已有的最新 foundation E2E 构建；过期时先按下方命令更新构建。测试可能下载包中已声明的运行依赖，不发布 npm、不替换用户的日常全局安装，也不测试 Claude Code 或 DeepSeek Harness。报告与安装包保存在 `.output/npm-acceptance/run-*/`。

仅验证包名、命令或打包入口等分发改动时，可加 `--package-only`，检查实际安装、配置、更新、注册与卸载；报告标记该范围，不执行浏览器业务回归。

`node tests/mcp-foundation/run.mjs --with-sdk --with-codex --with-authoring`（仓库根）在隔离扩展构建中运行正式接线和正式原生宿主，验证两个 Chrome 配置和 Firefox 的独立实例、通信、离线隔离；使用已安装 Codex 的临时会话直接调用编排工具，验证页面、子帧、清洗预览、保存与编辑、重复请求和非法流程拒绝，以及重启后的持久化。加 `--with-model` 另让 Codex 模型实际读取规则、页面取证、编排并保存一次；默认不调用模型。`--reuse-build` 可复用通过时间检查的现有测试构建。

测试构建预授予 nativeMessaging，临时 Codex 会话仅为隔离实例的 page_probe / workflow_save 预授予工具调用，避免无人交互的测试被客户端审批阻断。正式页面的可选权限和 Codex 工具审批仍需用户在客户端核对；测试不修改已有客户端配置。Claude Code 和 DeepSeek Harness 按用户要求暂缓测试。

执行验收额外传 `--with-execution`，同时回归编排、保存并运行本地夹具，检查暂停恢复、结束、同页拒绝和 MCP 会话退出后仍继续执行。`--with-execution-model` 另让 Codex 模型执行指定夹具流程，并为该隔离实例的 workflow_run / run_control 预先设置测试授权；模型仅能使用明确授权的本地流程。报告位于 `.output/.mcp-foundation/report.json`、`execution-model-report.json`。

数据验收传 `--with-datasets`，同时回归编排和执行，再真实读取采集结果、测试 501 行分页与超大行处理。`--with-dataset-model` 另让 Codex 模型查询并分页读取指定数据集；这两个数据工具为只读，不需要额外的写工具测试授权。模型报告为 `.output/.mcp-foundation/dataset-model-report.json`。
