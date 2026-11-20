# MCP 桥接器连接管理方案

[English](#english)

独立桥接器 0.4.1 使用三个命令管理连接。运行 `jtcrpa-mcp --version` 可核对当前终端调用的版本。

## 用户操作

| 操作 | 命令 | 行为 |
| --- | --- | --- |
| 查 | `jtcrpa-mcp list` | 列出浏览器、完整扩展 ID、目标实例和连接状态。离线的登记记录也能查到。 |
| 增 | `jtcrpa-mcp add --chrome-id <扩展ID>` | 按浏览器和完整扩展 ID 登记授权。首次自动添加，重复执行复用已有授权。Firefox 使用 `--firefox-id`。 |
| 删 | `jtcrpa-mcp remove` | 先列出连接，选中一条后移除。只有其他记录都不再引用该扩展时，才移除对应的浏览器授权。 |

通过 npm 安装桥接器后，用户从扩展的 MCP 页面复制 `jtcrpa-mcp add` 命令即可添加授权。第一次添加会同时注册本机宿主。同一浏览器已经登记其他扩展时，新 ID 追加到授权列表。对同一 ID 再次执行会提示已登记。如果宿主启动器或系统注册需要修复，也由 `add` 同步。

运行 `remove` 后按列表序号或编号选择并确认。脚本可用 `jtcrpa-mcp remove <连接编号>` 直接指定目标。

`list --json` 包含登记、已观察到的候选实例和归属待确认的实例。要给待选记录指定目标，运行 `add --chrome-id <扩展ID> --instance <列表中的UUID>`。首次选定目标会沿用该条记录的编号。对同一目标重复添加会复用原记录，添加另一个实例会分配新编号。Firefox 使用 `--firefox-id`。

## 一条连接记录

桥接器为每条记录分配稳定编号。登记授权时只需浏览器对应的扩展 ID。需要更换扩展或已选目标时，先添加新连接，将客户端指向新编号，再删除旧连接。

例如用 `jtcrpa-mcp config --connection c1` 生成客户端配置。生成的 stdio 启动参数使用这条登记的绑定 UUID。每次工具调用按绑定 UUID 读取已选目标并核对浏览器身份。卸载后即使显示编号重用，旧客户端也会收到 `CONNECTION_REMOVED`。通过 `--instance <UUID>` 直接指定实例的客户端仍按该 UUID 访问。

扩展 ID 用于浏览器授权。首次登记可暂留目标实例为空。浏览器握手后，列表显示该扩展下各实例的 UUID 和在线状态，供用户选择。无法确认归属时显示「待确认」。

## 存储与实施

- 连接记录由独立桥接器持久管理，浏览器断开后仍保留登记记录。
- 原生宿主启动及握手时，关联浏览器提供的扩展身份与实际实例 UUID，供列表查询和选择。
- 按浏览器汇总所有登记的扩展 ID，去重后写入相应清单。Chrome 使用 `allowed_origins`，Firefox 使用 `allowed_extensions`。[Chrome 原生通信清单](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host) · [Firefox 原生通信清单](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#native_messaging_manifests)
- 删除连接若影响活动会话，会列出受影响的实例，提示先断开对应连接。登记和清单统一写入，遇到并发操作或写入失败时保证两者一致。
- `uninstall` 清除当前用户的本机宿主登记。

## 验收场景

1. 首次添加成功后可以查到该记录，浏览器关闭后仍能查到。
2. 对同一浏览器的两个不同扩展 ID 分别运行注册命令，列表中有两条记录，两者都能连接。对其中任一 ID 再次运行，记录数、连接编号和已选实例保持一致。
3. 同一扩展的两个浏览器实例可以分别辨认。选定目标离线时显示离线，连接恢复后状态更新。
4. 按列表序号删除选中的连接，其他记录继续使用。并发登记同一目标只生成一条记录。写入失败时保留一致的授权结果。

## English

Version 0.4.1 provides three commands for managing connections. Use `jtcrpa-mcp --version` to check which version the current terminal resolves.

### Manage a connection

| Action | Command | Result |
| --- | --- | --- |
| List | `jtcrpa-mcp list` | Shows the browser, full extension ID, selected instance and current status. Registrations remain visible while offline. |
| Add | `jtcrpa-mcp add --chrome-id <extension-id>` | Registers that extension ID for Chrome. Repeating the command reuses the existing authorization. Use `--firefox-id` for Firefox. |
| Remove | `jtcrpa-mcp remove` | Prompts for a registration and confirms the selection. It removes the browser authorization when the last registration for that extension ID is removed. |

Install the npm package, then copy the registration command from the extension’s MCP page. The first registration installs the native host for the current Windows user. Further extension IDs are added to the browser’s manifest. Running `add` again also repairs a moved launcher or refreshes the registration where needed.

Use `remove <connection-number>` for non-interactive removal. `list --json` returns registrations, candidate instances and instances whose caller identity is still unconfirmed. To select a target, use `add --chrome-id <extension-id> --instance <uuid-from-list>`, or the corresponding Firefox command. The first selection keeps the connection number. Repeating the same selection reuses it. Selecting an additional instance creates another number.

### How a registration identifies a browser

The extension ID authorizes the extension in its browser. A registration may initially have no selected instance. After the browser handshake, the list shows instance UUIDs and availability. Unconfirmed identities are marked `待确认`. To replace a selected target or extension ID, add the new registration, update the client and then remove the old one.

`jtcrpa-mcp config --connection c1` embeds the registration’s binding UUID in the generated stdio arguments. Each tool call resolves the selected instance and checks the caller’s browser identity. An old client receives `CONNECTION_REMOVED` after its registration is removed, even if a new installation reuses its display number. Clients configured with `--instance <UUID>` address that instance directly.

### Storage and verification

- The bridge persists the registrations and associates the browser-supplied extension identity with the observed instance UUID during the native handshake.
- Each browser receives the unique extension IDs referenced by its registrations. Chrome uses `allowed_origins` and Firefox uses `allowed_extensions`. [Chrome native hosts](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host) · [Firefox native manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#native_messaging_manifests)
- Removing a registration that affects a live session identifies the instance to disconnect first. Registration and manifest updates are serialized. Failed writes trigger restoration of the previous state. `uninstall` removes native host registrations for the current installation.
- Acceptance covers persistent offline entries, independent extension IDs, selection of multiple profiles sharing an extension ID, reconnects, targeted removal, concurrent registration and write failures.
