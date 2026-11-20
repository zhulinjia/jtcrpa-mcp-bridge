# 九头虫 RPA MCP 桥接器 · Jiutouchong RPA MCP Bridge

[简体中文](#简体中文) · [English](#english)

## 简体中文

**九头虫 Agent** 是九头虫 RPA 的浏览器扩展。它可以把重复的网页操作保存为工作流，例如逐页采集商品名称和价格，并将结果保存为数据集。[九头虫 RPA 官网与扩展下载](https://jtcrpa.com/) · [九头虫 Agent 使用手册](https://doc.jtcrpa.com/)

`jtcrpa-mcp` 让 Codex 等外部 AI 客户端连接这个扩展。接通后，你可以直接在聊天里说：「在当前商品列表页运行已保存的采集流程，给我看前 20 行结果。」

### 首次连接

在 Chrome 或 Firefox 中打开九头虫 Agent，进入 **设置**，确认能看到 **MCP 连接**。Chrome 和 Firefox 商店发布的 `2.0.2` 版都没有这个入口。桥接器需要 Windows、Windows PowerShell 5.1 和 Node.js 20.19.0 或更高版本。

1. 在 PowerShell 中**安装桥接器**。

   ```powershell
   npm install -g jtcrpa-mcp
   ```

2. **连接浏览器。** 在扩展的 **设置 → MCP 连接** 页面，复制 **注册当前浏览器** 下的命令并在 PowerShell 中运行。打开 **开启 MCP 连接**，按提示允许本机通信。
3. **连接并验证 AI 客户端。** 当页面显示「浏览器与本机程序已连接」，在 **接入外部 AI** 中选择客户端，按页面提示完成配置。重新连接或重启客户端，发送「检查九头虫 MCP 连接，并列出当前浏览器标签页。」对照已打开的标签页即可确认连接到了正确的浏览器。

之后打开这个浏览器并保持 MCP 开启即可使用。要在终端查看已登记的连接，运行 `jtcrpa-mcp list`。

[客户端配置和使用示例](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#简体中文) · [故障排查](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#排查连接问题) · [开发与发布](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/publishing.md#简体中文)

## English

**Jiutouchong Agent** is the Jiutouchong RPA browser extension. It turns repetitive browser tasks into reusable workflows. For example, a workflow can collect product names and prices across several pages and save the results to a dataset. [Official website and extension downloads](https://jtcrpa.com/en) · [Jiutouchong Agent user manual](https://doc.jtcrpa.com/en/)

`jtcrpa-mcp` connects an external AI client such as Codex to the extension. Once connected, you can ask in chat, “Run my saved collection workflow on the current product listing and show me the first 20 rows.”

### First-time setup

Open **Settings** in Jiutouchong Agent in Chrome or Firefox and check for **MCP connection**. The `2.0.2` releases distributed by both browser stores lack this feature. The bridge requires Windows, Windows PowerShell 5.1 and Node.js 20.19.0 or later.

1. **Install the bridge** in PowerShell.

   ```powershell
   npm install -g jtcrpa-mcp
   ```

2. **Connect your browser.** In the extension, open **Settings → MCP connection**. Copy the command under **Register this browser** and run it in PowerShell. Turn on **Enable MCP connection** and allow native messaging when prompted.
3. **Connect and verify your AI client.** Once the page shows **Browser connected to the local program**, choose your client under **Connect an AI app** and follow the instructions there. Reconnect or restart the client and ask, “Check the Jiutouchong MCP connection and list the tabs in the connected browser.” Check that the returned tabs match the browser profile you wanted to connect.

For daily use, open the same profile with MCP enabled. To list registered connections in the terminal, run `jtcrpa-mcp list`.

[Client configuration and examples](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#english) · [Troubleshooting](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/usage.md#troubleshooting) · [Development and publishing](https://github.com/zhulinjia/jtcrpa-mcp-bridge/blob/main/docs/publishing.md#english)
