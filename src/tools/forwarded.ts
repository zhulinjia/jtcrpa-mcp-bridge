import type { McpServer } from '@modelcontextprotocol/server';
import { callExtension } from '../ipc.ts';
import type { ForwardedToolDefinition } from './definition.ts';

export function registerForwardedTools(
    server: McpServer,
    instanceId: string,
    definitions: readonly ForwardedToolDefinition[],
) {
    for (const definition of definitions) {
        server.registerTool(definition.name, {
            description: definition.description,
            inputSchema: definition.schema,
            annotations: {
                readOnlyHint: definition.readOnly,
                idempotentHint: definition.readOnly,
                destructiveHint: !definition.readOnly,
                openWorldHint: definition.openWorld,
            },
        }, (params) => forwardToolCall(instanceId, definition, params));
    }
}

async function forwardToolCall(
    instanceId: string,
    definition: ForwardedToolDefinition,
    params: unknown,
) {
    try {
        const result = await callExtension(instanceId, definition.name, params);
        return toToolResult(result);
    } catch (error) {
        const failure: { error: string; message?: string } = {
            error: (error as Error).message,
        };
        if (!definition.readOnly) {
            failure.message = 'Outcome may be unknown. Query connection_status with requestId; do not automatically replay.';
        }
        return toToolResult(failure);
    }
}

function toToolResult(result: unknown) {
    const content = [{ type: 'text' as const, text: JSON.stringify(result) }];
    if (isToolFailure(result)) return { isError: true, content };
    return { content };
}

function isToolFailure(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    if ('error' in result) return true;
    return 'ok' in result && result.ok === false;
}
