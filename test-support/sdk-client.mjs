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
        assert.match(client.getInstructions() ?? '', /Keep the page open after saving/);
        assert.match(client.getInstructions() ?? '', /滚动加载/);
        const tools = await client.listTools();
        assert.ok(tools.tools.every(tool => tool.description?.trim()));
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['browser_context', 'capability_probe', 'connection_ping', 'connection_status', 'dataset_list', 'dataset_read', 'page_close', 'page_open', 'page_probe', 'run_control', 'run_get', 'workflow_contract', 'workflow_get', 'workflow_list', 'workflow_run', 'workflow_save']);
        for (const name of ['page_probe', 'workflow_save', 'workflow_run', 'page_close']) {
            assert.ok(tools.tools.find(tool => tool.name === name).inputSchema.required.includes('pageRef'));
        }
        const contract = tools.tools.find((tool) => tool.name === 'workflow_contract');
        const capability = tools.tools.find(tool => tool.name === 'capability_probe');
        assert.equal(capability.annotations.readOnlyHint, true);
        assert.deepEqual(capability.inputSchema.required, ['tool']);
        assert.deepEqual(capability.inputSchema.properties.tool.enum, ['probeUserScript', 'probeFileAccess', 'probeFeishu']);
        const probe = await client.callTool({ name: 'capability_probe', arguments: { tool: 'probeUserScript' } });
        if (expectedOnline) assert.deepEqual(JSON.parse(probe.content[0].text), { status: 'READY' });
        else assert.equal(probe.isError, true);
        const invalidProbe = await client.callTool({ name: 'capability_probe', arguments: { tool: 'probeClick' } });
        assert.equal(invalidProbe.isError, true);
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
