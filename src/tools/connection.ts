import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { callExtension } from '../ipc.ts';

// 连接状态和回声测试的离线返回不同，保留各自的处理语义。
export function registerConnectionTools(server: McpServer, instanceId: string) {
    server.registerTool('connection_status', {
        description: '查询所配置的九头虫浏览器实例及其连接状态。',
        inputSchema: z.object({
            requestId: z.uuid().optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
    }, async (params) => {
        let result: unknown;
        try {
            result = await callExtension(instanceId, 'connection_status', params);
        } catch (error) {
            result = { connected: false, instanceId, error: (error as Error).message };
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
            const result = await callExtension(instanceId, 'connection_ping', { text });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
        }
    });
}
