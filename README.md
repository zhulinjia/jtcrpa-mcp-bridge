# 九头虫 RPA MCP 桥接器 · Jiutouchong RPA MCP Bridge

[简体中文](#简体中文) · [English](#english)

## 简体中文

`jtcrpa-mcp` 把外部 AI 客户端接到你浏览器里的**九头虫 Agent**。下面用 Codex 做一次完整采集。你会在聊天里拿到书店首页 4 本书的书名和价格，还能把同一条规则用到下一页。[九头虫 RPA 官网与扩展下载](https://jtcrpa.com/) · [九头虫 Agent 使用手册](https://doc.jtcrpa.com/)

### 首次连接

1. **浏览器里找到 MCP 入口。** 在 Windows 上将**九头虫 Agent** 添加到 Chrome 或 Firefox。点击浏览器工具栏的九头虫图标打开侧边栏，再点底部的 **设置菜单 ☰ → MCP 连接**。打开页面后应能看到 **开启 MCP 连接** 开关。[设置菜单截图](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/images/settings-menu-zh.png) · [扩展安装说明](https://doc.jtcrpa.com/guide/install.html)

   如果菜单里没有这个入口，先确认扩展版本。Chrome 和 Firefox 商店发布的 `2.0.2` 都缺少 MCP。只有商店版时，可向九头虫咨询支持 MCP 的安装包。[联系九头虫](https://jtcrpa.com/contact)

2. **在 PowerShell 安装桥接器。** 从 Windows 开始菜单打开 PowerShell。需要 Windows PowerShell 5.1 和 Node.js 20.19.0 或更高版本。逐行运行下面的命令，第一行检查 Node.js，最后一行应显示桥接器版本号。[Node.js 下载](https://nodejs.org/en/download)

   ```powershell
   node --version
   npm install -g jtcrpa-mcp
   jtcrpa-mcp --version
   ```

3. **把这个浏览器连上。** 回到扩展的 **MCP 连接 → 注册当前浏览器**，点击复制按钮，把整条命令粘贴到刚才的 PowerShell 并按回车。页面已填好当前扩展的 ID。回到扩展打开 **开启 MCP 连接**，浏览器询问时允许本机通信。看到 **浏览器与本机程序已连接** 再继续。
4. **把 Codex 连上。** 在同一页的 **接入外部 AI → Codex** 点击 **复制 Codex 接入命令**，在 PowerShell 粘贴并执行。运行 `codex mcp list` 应能看到 `jtcrpa`。打开一个新的 Codex 会话，下面三条消息都发在这个会话里。已安装并登录的 Codex CLI 可以在 PowerShell 输入 `codex` 打开。[安装 Codex CLI](https://developers.openai.com/codex/cli/) · [使用 Claude Code 或 DeepSeek Harness](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#客户端配置)

### 第一次用 MCP 采集书名和价格

**① 打开网页，确认连到了它。** 用刚才连接的浏览器打开书店首页。如果页面显示英文，点页头的 **简体中文**。然后在 **Codex 聊天框**发送第一条消息。[打开书店练习场](https://doc.jtcrpa.com/practice/index.html)

> 用九头虫 MCP 检查连接，找到我打开的书店练习场标签页。告诉我页面标题，并从页面上读出第一本书的书名和价格。

返回结果应能跟页面对上，第一本是《山海之间》，价格 ¥32.00。若找错页，先核对打开练习场的浏览器和配置，再继续。

**② 保存一条可复用的规则。** 在同一个聊天里发送第二条消息。

> 把书店当前列表页的每本书采成一行，书名列叫 title，价格列叫 price，保留货币符号，只采当前页。先在页面上试采，再把规则保存为工作流「Bookshop demo」，运行时写入数据集 bookshop_demo。告诉我保存的工作流编号，等我确认再运行。

此时你应拿到 `workflowId`（工作流编号）。也可以在扩展的 **主工作台** 搜索 `Bookshop demo` 查看已保存的规则。

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

1. **Find MCP in the browser.** On Windows, add **Jiutouchong Agent** to Chrome or Firefox. Click its toolbar icon to open the sidebar, then choose **Settings ☰ → MCP connection** at the bottom. Look for the **Enable MCP connection** switch. [See the Settings menu](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/images/settings-menu-en.png) · [Extension installation guide](https://doc.jtcrpa.com/en/guide/install.html)

   If the menu entry is missing, check the extension build. Version `2.0.2` from both browser stores lacks MCP. If you only have the store release, contact Jiutouchong about an MCP-enabled build. [Contact Jiutouchong](https://jtcrpa.com/en/contact)

2. **Install the bridge in PowerShell.** Open PowerShell from the Windows Start menu. You need Windows PowerShell 5.1 and Node.js 20.19.0 or later. Run these lines in order. The first prints your Node.js version and the last should print the bridge version. [Download Node.js](https://nodejs.org/en/download)

   ```powershell
   node --version
   npm install -g jtcrpa-mcp
   jtcrpa-mcp --version
   ```

3. **Connect this browser.** On the extension’s **MCP connection** page, copy the command under **Register this browser**. Paste it into PowerShell and press Enter. It already contains your extension’s ID. Back in the extension, turn on **Enable MCP connection** and allow native messaging if prompted. Continue when you see **Browser connected to the local program**.
4. **Connect Codex.** On the same page, under **Connect an AI app → Codex**, click **Copy Codex setup command** and run it in PowerShell. Run `codex mcp list` and look for `jtcrpa`. Open a new Codex session for the three messages below. If the Codex CLI is installed and you’re signed in, type `codex` in PowerShell to start it. [Install the Codex CLI](https://developers.openai.com/codex/cli/) · [Use Claude Code or DeepSeek Harness](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#client-configuration)

### Collect your first four books

**① Open the page and check the connection.** Open the bookshop homepage in the browser you just connected. If it appears in Chinese, click **English** in the page header. Send this first message in **Codex chat**. [Open the bookshop playground](https://doc.jtcrpa.com/en/practice/index.html)

> Use Jiutouchong MCP to check the connection and find my open bookshop playground tab. Tell me the page title and read the first book’s title and price from the page.

You should see *Between Mountains and Seas* at ¥32.00. If the result is from a different page, check which browser profile has the bookshop open.

**② Save a reusable workflow.** Send this in the same chat.

> Collect one row per book on the current listing page. Name the columns title and price and keep the currency symbol. Preview the extraction on the page, then save a workflow named “Bookshop demo” that writes to the bookshop_demo dataset when run. Give me the saved workflow ID and wait for my confirmation.

You should receive a `workflowId`. To find the saved rule in the extension, open **Workbench** and search for `Bookshop demo`.

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
