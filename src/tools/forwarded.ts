import type { McpServer } from '@modelcontextprotocol/server';
import { callExtension, type McpTarget } from '../ipc.ts';
import { findBinding } from '../connections.ts';
import type { ForwardedToolDefinition } from './definition.ts';

export function registerForwardedTools(
    server: McpServer,
    target: McpTarget,
    definitions: readonly ForwardedToolDefinition[],
) {
    for (const definition of definitions) {
        server.registerTool(definition.name, {
            description: definition.description,
            inputSchema: definition.schema,
            annotations: {
                readOnlyHint: definition.readOnly,
                idempotentHint: definition.readOnly,
                destructiveHint: definition.destructive ?? !definition.readOnly,
                openWorldHint: definition.openWorld,
            },
        }, (params) => {
            const source = typeof target !== 'string' && target.expectedInstanceId &&
                /(?:^|[^a-z])codex(?:[^a-z]|$)/i.test(server.server.getClientVersion()?.name ?? '')
                ? { ...target, reportCodexAccess: true } : target;
            return forwardToolCall(source, definition, params);
        });
    }
}

async function forwardToolCall(
    target: McpTarget,
    definition: ForwardedToolDefinition,
    params: unknown,
) {
    try {
        const result = await callExtension(target, definition.name, params);
        return toToolResult(result);
    } catch (error) {
        const failure: { error: string; message?: string } = {
            error: (error as Error).message,
        };
        if (failure.error === 'BROWSER_OFFLINE') {
            const binding = typeof target === 'string' ? undefined : findBinding(target.bindingId);
            failure.message = (binding?.label || '目标浏览器') + '已离线。请在该浏览器中开启九头虫 MCP。';
        } else if (failure.error === 'CONNECTION_INSTANCE_MISMATCH' || failure.error === 'CONNECTION_REMOVED') {
            failure.message = '原浏览器绑定已变更，请从目标浏览器重新接入。';
        } else if (failure.error === 'UNKNOWN_METHOD' && (definition.name === 'page_open' || definition.name === 'page_close')) {
            failure.message = '当前连接尚未提供此页面工具。请配套更新目标浏览器中的九头虫扩展和本机桥接器。';
        } else if (!definition.readOnly) {
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
