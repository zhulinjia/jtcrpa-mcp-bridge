import net from 'node:net';
import { readDiscovery } from './paths.ts';
import { MAX_BYTES } from './protocol.ts';

export function callExtension(instanceId: string, method: string, params: unknown = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let record: ReturnType<typeof readDiscovery>;
        try { record = readDiscovery(instanceId); } catch { reject(new Error('BROWSER_OFFLINE')); return; }
        const request = JSON.stringify({ token: record.token, method, params }) + '\n';
        if (Buffer.byteLength(request) > MAX_BYTES - 1024) { reject(new Error('MESSAGE_TOO_LARGE')); return; }
        const socket = net.createConnection(record.pipe);
        let result: Buffer = Buffer.alloc(0);
        const timer = setTimeout(() => socket.destroy(new Error('BRIDGE_TIMEOUT')), 50000);
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
        socket.on('error', reject);
        socket.on('end', () => { if (!result.includes(10)) reject(new Error('BRIDGE_CLOSED')); });
        socket.on('close', () => clearTimeout(timer));
    });
}
