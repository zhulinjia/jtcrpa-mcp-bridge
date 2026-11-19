import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { validInstance } from './protocol.ts';
import { registerConnectionTools } from './tools/connection.ts';
import { registerForwardedTools } from './tools/forwarded.ts';
import { authoringTools } from './tools/authoring.ts';
import { executionTools } from './tools/execution.ts';
import { datasetTools } from './tools/datasets.ts';

export async function serveMcp(instanceId: string) {
    if (!validInstance(instanceId)) throw new Error('INVALID_INSTANCE_ID');
    serveStdio(() => {
        const server = new McpServer({ name: 'jtcrpa', version: '0.1.0' });
        registerConnectionTools(server, instanceId);

        registerForwardedTools(server, instanceId, authoringTools);
        registerForwardedTools(server, instanceId, executionTools);
        registerForwardedTools(server, instanceId, datasetTools);
        return server;
    });
}
