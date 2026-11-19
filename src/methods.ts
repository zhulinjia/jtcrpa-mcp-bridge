/** Native host 白名单与 MCP 工具面同步；不接受任意扩展 RPC。 */
export const METHODS = ['connection_status', 'connection_ping', 'browser_context', 'workflow_contract', 'page_probe', 'workflow_list', 'workflow_get', 'workflow_save', 'workflow_run', 'run_get', 'run_control', 'dataset_list', 'dataset_read'] as const;
