import net from 'node:net';
import { readDiscovery } from './paths.ts';
import { MAX_BYTES } from './protocol.ts';
import { findBinding } from './connections.ts';
import { sameExtension } from './browser-identity.ts';

export type McpTarget = string | { bindingId: string; expectedInstanceId?: string; reportCodexAccess?: boolean };

export function callExtension(target: McpTarget, method: string, params: unknown = {}, timeoutMs = 50000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const connection = typeof target === 'string' ? undefined : findBinding(target.bindingId);
        if (typeof target !== 'string' && !connection) throw new Error('CONNECTION_REMOVED');
        const expectedInstanceId = typeof target === 'string' ? undefined : target.expectedInstanceId;
        if (expectedInstanceId && connection?.instanceId !== expectedInstanceId) throw new Error('CONNECTION_INSTANCE_MISMATCH');
        const instanceId = typeof target === 'string' ? target : connection?.instanceId;
        if (!instanceId) throw new Error('CONNECTION_INSTANCE_NOT_SELECTED');
        let record: ReturnType<typeof readDiscovery>;
        try { record = readDiscovery(instanceId); } catch { reject(new Error('BROWSER_OFFLINE')); return; }
        if (connection && !sameExtension(connection, record.caller)) throw new Error('CONNECTION_INSTANCE_MISMATCH');
        const request = JSON.stringify({ token: record.token, method, params,
            expectedInstanceId, codexBinding: expectedInstanceId ? connection?.bindingId : undefined,
            codexAccess: typeof target !== 'string' && target.reportCodexAccess || undefined }) + '\n';
        if (Buffer.byteLength(request) > MAX_BYTES - 1024) { reject(new Error('MESSAGE_TOO_LARGE')); return; }
        const socket = net.createConnection(record.pipe);
        let result: Buffer = Buffer.alloc(0);
        const timer = setTimeout(() => socket.destroy(new Error('BRIDGE_TIMEOUT')), timeoutMs);
        socket.on('connect', () => socket.write(request));
        socket.on('data', (chunk) => {
            result = Buffer.concat([result, chunk]);
            if (result.length > MAX_BYTES) return socket.destroy(new Error('MESSAGE_TOO_LARGE'));
            const end = result.indexOf(10);
            if (end < 0) return;
            try {
                const reply = JSON.parse(result.subarray(0, end).toString('utf8')) as { ok: boolean; result?: unknown; error?: string };
                reply.ok ? resolve(reply.result) : reject(new Error(reply.error ?? 'BRIDGE_ERROR'));
            } catch (error) { reject(error); }
            socket.destroy();
        });
        socket.on('error', (error: NodeJS.ErrnoException) =>
            reject(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? new Error('BROWSER_OFFLINE') : error));
        socket.on('end', () => { if (!result.includes(10)) reject(new Error('BRIDGE_CLOSED')); });
        socket.on('close', () => clearTimeout(timer));
    });
}
