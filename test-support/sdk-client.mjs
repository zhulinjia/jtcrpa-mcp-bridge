import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function verifySdkConnection(instanceId, expectedOnline, bridgeHome) {
    const client = new Client({ name: 'jtcrpa-integration', version: '1.0.0' });
    const bridgeCli = process.env.JTCRPA_BRIDGE_CLI ?? fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
    const transport = new StdioClientTransport({ command: process.execPath, args: [bridgeCli, 'mcp', '--instance', instanceId], env: { ...process.env, ...(bridgeHome ? { JTCRPA_BRIDGE_HOME: bridgeHome } : {}) } });
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['browser_context', 'connection_ping', 'connection_status', 'dataset_list', 'dataset_read', 'page_probe', 'run_control', 'run_get', 'workflow_contract', 'workflow_get', 'workflow_list', 'workflow_run', 'workflow_save']);
        const contract = tools.tools.find((tool) => tool.name === 'workflow_contract');
        assert.equal(contract.inputSchema.properties.guideDetail, undefined);
        assert.ok(tools.tools.find((tool) => tool.name === 'workflow_save').description.includes('等待本次保存之后的明确确认'));
        assert.ok(tools.tools.find((tool) => tool.name === 'workflow_run').description.includes('等待本次保存之后的明确确认'));
        const status = await client.callTool({ name: 'connection_status', arguments: {} });
        assert.equal(JSON.parse(status.content[0].text).connected, expectedOnline);
        const result = await client.callTool({ name: 'connection_ping', arguments: { text: 'MCP 中文' } });
        if (expectedOnline) assert.deepEqual(JSON.parse(result.content[0].text), { instanceId, text: 'MCP 中文' });
        else assert.equal(result.isError, true);
        const invalid = await client.callTool({ name: 'connection_ping', arguments: { text: 'x'.repeat(129) } });
        assert.equal(invalid.isError, true);
    } finally { await client.close(); }
}
