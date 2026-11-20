# MCP 桥接器连接管理方案

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
