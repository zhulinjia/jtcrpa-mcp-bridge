import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { callExtension, type McpTarget } from '../ipc.ts';
import { connectionName, findBinding } from '../connections.ts';

// 连接状态和回声测试的离线返回不同，保留各自的处理语义。
export function registerConnectionTools(server: McpServer, target: McpTarget) {
    server.registerTool('connection_status', {
        description: '查询所配置的九头虫浏览器实例及其连接状态。',
        inputSchema: z.object({
            requestId: z.uuid().optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (params) => {
        let result: unknown;
        try {
            result = await callExtension(target, 'connection_status', params);
            if (typeof target !== 'string' && target.expectedInstanceId && result && typeof result === 'object') {
                const binding = findBinding(target.bindingId);
                if (binding?.instanceId === target.expectedInstanceId) result = { ...result, connectionId: binding.id, browserName: connectionName(binding) };
            }
        } catch (error) {
            const binding = typeof target === 'string' ? undefined : findBinding(target.bindingId);
            result = { connected: false, instanceId: typeof target === 'string' ? target : target.expectedInstanceId ?? binding?.instanceId ?? null,
                connectionId: binding?.id, error: (error as Error).message };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });

    server.registerTool('connection_ping', {
        description: '向浏览器扩展发送一段简短测试文本并原样返回，验证完整通信往返。',
        inputSchema: z.object({
            text: z.string().max(128),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async ({ text }) => {
        try {
            const result = await callExtension(target, 'connection_ping', { text });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
        }
    });
}
