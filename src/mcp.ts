import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRequire } from 'node:module';
import { validInstance } from './protocol.ts';
import type { McpTarget } from './ipc.ts';
import { registerConnectionTools } from './tools/connection.ts';
import { registerForwardedTools } from './tools/forwarded.ts';
import { authoringTools } from './tools/authoring.ts';
import { executionTools } from './tools/execution.ts';
import { datasetTools } from './tools/datasets.ts';

export async function serveMcp(target: McpTarget) {
    if (!validInstance(typeof target === 'string' ? target : target.bindingId)) throw new Error('INVALID_MCP_TARGET');
    serveStdio(() => {
        const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
        const server = new McpServer({ name: 'jtcrpa', version });
        registerConnectionTools(server, target);

        registerForwardedTools(server, target, authoringTools);
        registerForwardedTools(server, target, executionTools);
        registerForwardedTools(server, target, datasetTools);
        return server;
    });
}
