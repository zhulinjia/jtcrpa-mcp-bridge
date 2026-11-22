# 九头虫 RPA MCP 桥接器 · Jiutouchong RPA MCP Bridge

[简体中文](#简体中文) · [English](#english)

## 简体中文

`jtcrpa-mcp` 把外部 AI 客户端接到你浏览器里的**九头虫 Agent**。下面用 Codex 做一次完整采集。你会在聊天里拿到书店首页 4 本书的书名和价格，还能把同一条规则用到下一页。[九头虫 RPA 官网与扩展下载](https://jtcrpa.com/) · [九头虫 Agent 使用手册](https://doc.jtcrpa.com/)

### 首次连接

1. **浏览器里找到 MCP 入口。** 在 macOS 或 Windows 上将**九头虫 Agent** 添加到 Edge、Chrome 或 Firefox。点击浏览器工具栏的九头虫图标打开侧边栏，再点底部的 **设置菜单 ☰ → MCP 连接**。打开页面后应能看到 **开启 MCP 连接** 开关。[设置菜单截图](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/images/settings-menu-zh.png) · [扩展安装说明](https://doc.jtcrpa.com/guide/install.html)

   如果菜单里没有这个入口，先确认扩展版本。Chrome 和 Firefox 商店发布的 `2.0.2` 都缺少 MCP。只有商店版时，可向九头虫咨询支持 MCP 的安装包。[联系九头虫](https://jtcrpa.com/contact)

2. **在终端安装桥接器。** 需要 Node.js 20.19.0 或更高版本。macOS 打开「终端」，Windows 打开 PowerShell 5.1。已发布的兼容版本可用下面的命令安装。[Node.js 下载](https://nodejs.org/en/download)

   ```sh
   node --version
   npm install -g jtcrpa-mcp
   jtcrpa-mcp --version
   ```

   下述流程使用桥接器 0.8.0+ 和配套扩展。开发测试可使用本仓库的 `npm pack` 安装包。

   接口目录、响应样例、接口试采和用户选中的本地文件预览需要桥接器 0.9.0+ 及配套扩展。[调用说明](docs/usage.md)

3. **绑定当前浏览器。** 在 **MCP 连接** 页面开启连接，允许本机通信。复制页面给出的整条 `jtcrpa-mcp connect` 命令，在终端运行。
4. **把配置交给 AI。** 回到插件页点击 **复制 MCP 配置**，将 JSON 发给支持本机 stdio 的 AI 客户端，请它添加这项服务。终端也会输出同一份 JSON。要添加其他浏览器，从对应浏览器的插件页重复操作。[客户端配置说明](docs/usage.md#客户端配置)

### 第一次用 MCP 采集书名和价格

**① 读取网页。** 在已接入九头虫 MCP 的 AI 对话中发送下面的任务。九头虫会在已绑定的浏览器中打开或复用目标页，沿用该浏览器的登录状态。如果书店显示英文，可在页头切到 **简体中文**。

> 用九头虫打开 https://doc.jtcrpa.com/practice/index.html ，告诉我页面标题和第一本书的书名、价格。

练习场首页的第一本书是《山海之间》，价格 ¥32.00。

**② 保存一条可复用的规则。** 在同一个聊天里发送第二条消息。

> 把书店当前列表页的每本书采成一行，书名列叫 title，价格列叫 price，保留货币符号，只采当前页。先在页面上试采，再把规则保存为工作流「Bookshop demo」，运行时写入数据集 bookshop_demo。告诉我保存的工作流编号，等我确认再运行。

此时你应拿到 `workflowId`（工作流编号）。也可以在扩展的 **主工作台** 搜索 `Bookshop demo` 查看已保存的规则。页面会保留，方便检查或试运行。需要关页时，可以自己关闭，也可以在对话里明确指定要关闭的页面。

**③ 运行并核对数据。** 收到保存结果后，再单独发第三条消息。

> 确认，现在在刚才的书店首页运行 Bookshop demo。等运行结束，告诉我本次写了几行，再从 bookshop_demo 读出 title 和 price，用表格显示。

首次在空数据集中运行，本次应写入 **4 行**。也可以在扩展的 **数据存储** 找到 `bookshop_demo`，点 **预览**，对照同一份结果。

| title | price |
| --- | --- |
| 山海之间 | ¥32.00 |
| 城市慢行 | ¥45.00 |
| 生活的留白 | ¥39.00 |
| 月光落在书页上 | ¥28.50 |

**下次复用。** 点击书店的 **下一页**，在聊天中说「找到已保存的 Bookshop demo，在书店第 2 页运行，告诉我这次写入几行」。这次应再写入 4 行，其中有《旅途中的小地图》¥48.00。以后打开同一浏览器配置并保持 MCP 开启即可，浏览器和客户端会按需启动桥接器。

[MCP 工具的实际参数和调用顺序](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#书店示例的工具调用) · [连接或采集遇到问题](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#排查连接问题) · [开发与发布](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/publishing.md#简体中文)

## English

`jtcrpa-mcp` connects an external AI client to **Jiutouchong Agent** in your browser. In this walkthrough, you’ll use Codex chat to collect the four titles and prices on a bookshop page, check the saved rows and run the same workflow on the next page. [Jiutouchong RPA website and extension downloads](https://jtcrpa.com/en) · [Jiutouchong Agent user manual](https://doc.jtcrpa.com/en/)

### First-time setup

1. **Find MCP in the browser.** On macOS or Windows, add **Jiutouchong Agent** to Edge, Chrome or Firefox. Click its toolbar icon to open the sidebar, then choose **Settings ☰ → MCP connection** at the bottom. Look for the **Enable MCP connection** switch. [See the Settings menu](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/images/settings-menu-en.png) · [Extension installation guide](https://doc.jtcrpa.com/en/guide/install.html)

   If the menu entry is missing, check the extension build. Version `2.0.2` from both browser stores lacks MCP. If you only have the store release, contact Jiutouchong about an MCP-enabled build. [Contact Jiutouchong](https://jtcrpa.com/en/contact)

2. **Install the bridge in a terminal.** Use Node.js 20.19.0 or later. Open Terminal on macOS or PowerShell 5.1 on Windows. For a published version supporting your platform, run the following commands. [Download Node.js](https://nodejs.org/en/download)

   ```sh
   node --version
   npm install -g jtcrpa-mcp
   jtcrpa-mcp --version
   ```

   These steps require bridge 0.8.0 or later and a matching extension. For a development checkout, install the local package produced by `npm pack`.

   Network discovery, response samples, network extraction previews, and previews of user-selected local files require bridge 0.9.0 or later and a matching extension. [Tool usage](docs/usage.md)

3. **Bind the browser.** In the target profile, enable **MCP connection**, allow native messaging and run the full `jtcrpa-mcp connect` command shown on the page.
4. **Copy the configuration.** Click **Copy MCP configuration** and ask your AI to add the JSON to its local stdio client settings. The terminal prints the same JSON. Repeat from another browser profile to add that profile. [Client configuration](docs/usage.md#client-configuration)

### Collect your first four books

**① Read a page.** Send this task in an AI conversation connected to Jiutouchong MCP. The tool opens or reuses the page in the bound browser profile, using that profile’s sign-in state. If the bookshop appears in Chinese, select **English** in the page header.

> Use Jiutouchong to open https://doc.jtcrpa.com/en/practice/index.html and tell me the page title and the first book’s title and price.

The first book on the practice homepage is *Between Mountains and Seas* at ¥32.00.

**② Save a reusable workflow.** Send this in the same chat.

> Collect one row per book on the current listing page. Name the columns title and price and keep the currency symbol. Preview the extraction on the page, then save a workflow named “Bookshop demo” that writes to the bookshop_demo dataset when run. Give me the saved workflow ID and wait for my confirmation.

You should receive a `workflowId`. To find the saved rule in the extension, open **Workbench** and search for `Bookshop demo`. The tab stays open for review or a trial run. Close it yourself or explicitly ask the assistant to close that specific page.

**③ Run it and check the saved rows.** Once the client reports that it saved the workflow, send a separate message.

> Yes, run Bookshop demo on the bookshop homepage now. Wait for it to finish, tell me how many rows this run saved, then read title and price from bookshop_demo and show them as a table.

On the first run with an empty dataset, expect **four rows**. You can also open **Storage** in the extension, find `bookshop_demo` and click **Preview** to see the same records.

| title | price |
| --- | --- |
| Between Mountains and Seas | ¥32.00 |
| City Strolls | ¥45.00 |
| Room to Breathe | ¥39.00 |
| Moonlight on the Page | ¥28.50 |

**Use it again.** Click **Next** in the bookshop, then ask, “Find my saved Bookshop demo workflow, run it on page 2 of the bookshop and tell me how many rows this run saved.” Expect four more rows, including *Little Maps for the Journey* at ¥48.00. For future sessions, open the same browser profile with MCP enabled. The browser and client start the bridge as needed.

[MCP tool calls and their arguments](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#tool-calls-for-the-bookshop-example) · [Connection and collection troubleshooting](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#troubleshooting) · [Development and publishing](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/publishing.md#english)
