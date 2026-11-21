import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRequire } from 'node:module';
import { validInstance } from './protocol.ts';
import type { McpTarget } from './ipc.ts';
import { connectionName, findBinding } from './connections.ts';
import { registerConnectionTools } from './tools/connection.ts';
import { registerForwardedTools } from './tools/forwarded.ts';
import { authoringTools } from './tools/authoring.ts';
import { executionTools } from './tools/execution.ts';
import { datasetTools } from './tools/datasets.ts';

export async function serveMcp(target: McpTarget) {
    if (!validInstance(typeof target === 'string' ? target : target.bindingId)) throw new Error('INVALID_MCP_TARGET');
    serveStdio(() => {
        const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
        const binding = typeof target === 'string' || !target.expectedInstanceId ? undefined : findBinding(target.bindingId);
        const server = new McpServer({ name: 'jtcrpa', version, ...(binding ? { title: '九头虫 · ' + connectionName(binding) } : {}) }, {
            instructions: 'For a workflow targeting a URL, use page_open on this server to open it in the bound browser. For an existing tab use browser_context. Pass the returned tabId and pageRef to this same server for inspection, saving and execution. Keep the page open after saving. Call page_close only when the user explicitly asks to close that specific page.',
        });
        registerConnectionTools(server, target);

        registerForwardedTools(server, target, authoringTools);
        registerForwardedTools(server, target, executionTools);
        registerForwardedTools(server, target, datasetTools);
        return server;
    });
}
