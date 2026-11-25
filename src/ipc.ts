import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { readDiscovery } from './paths.ts';
import { MAX_BYTES } from './protocol.ts';
import { findBinding } from './connections.ts';
import { sameExtension } from './browser-identity.ts';

export type McpTarget = string | { bindingId: string; expectedInstanceId?: string; reportCodexAccess?: boolean; routingGrant?: string };

// Failures of this type occurred before any bytes of the business request were sent.
class BeforeDispatchError extends Error {}

function resolveTarget(target: McpTarget) {
    const bound = typeof target === 'string' ? undefined : target;
    const connection = bound && findBinding(bound.bindingId);
    if (bound && !connection) throw new Error('CONNECTION_REMOVED');
    const expected = bound?.expectedInstanceId;
    if (expected && connection?.instanceId !== expected) throw new Error('CONNECTION_INSTANCE_MISMATCH');
    if (bound?.routingGrant !== undefined && (!expected || bound.routingGrant !== connection?.routing?.grantId)) {
        throw new Error('ROUTER_ACCESS_REVOKED');
    }
    const instanceId = typeof target === 'string' ? target : connection?.instanceId;
    if (!instanceId) throw new Error('CONNECTION_INSTANCE_NOT_SELECTED');
    let record: ReturnType<typeof readDiscovery>;
    try {
        record = readDiscovery(instanceId);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BeforeDispatchError('BROWSER_OFFLINE');
        throw error;
    }
    if (connection && !sameExtension(connection, record.caller)) throw new Error('CONNECTION_INSTANCE_MISMATCH');
    return { record, expected, bindingId: expected ? connection?.bindingId : undefined };
}

async function dispatch(target: McpTarget, method: string, params: unknown, deadline: number, connectDeadline: number): Promise<unknown> {
    const { record, expected, bindingId } = resolveTarget(target);
    const bound = typeof target === 'string' ? undefined : target;
    const request = JSON.stringify({ token: record.token, method, params, expectedInstanceId: expected,
        codexBinding: bindingId, codexAccess: bound?.reportCodexAccess || undefined, routingGrant: bound?.routingGrant }) + '\n';
    if (Buffer.byteLength(request) > MAX_BYTES - 1024) throw new Error('MESSAGE_TOO_LARGE');
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(record.pipe);
        let result: Buffer = Buffer.alloc(0);
        let sent = false;
        let timer = setTimeout(() => socket.destroy(new BeforeDispatchError('BROWSER_RECOVERING')), Math.max(1, connectDeadline - Date.now()));
        socket.on('connect', () => {
            try {
                // The user may revoke access or restart this browser while the socket connects.
                if (bound?.routingGrant !== undefined && resolveTarget(target).record.session !== record.session) {
                    socket.destroy(new BeforeDispatchError('BROWSER_RECOVERING'));
                    return;
                }
                clearTimeout(timer);
                timer = setTimeout(() => socket.destroy(new Error('BRIDGE_TIMEOUT')), Math.max(1, deadline - Date.now()));
                sent = true;
                socket.write(request);
            } catch (error) {
                socket.destroy(error as Error);
            }
        });
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
        socket.on('error', (error: NodeJS.ErrnoException) => {
            if (!sent && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
                try {
                    process.kill(record.pid, 0);
                    reject(new BeforeDispatchError('BROWSER_RECOVERING'));
                } catch {
                    reject(new BeforeDispatchError('BROWSER_OFFLINE'));
                }
                return;
            }
            reject(error);
        });
        socket.on('end', () => { if (!result.includes(10)) reject(new Error('BRIDGE_CLOSED')); });
        socket.on('close', () => {
            clearTimeout(timer);
            if (!result.includes(10)) reject(new Error('BRIDGE_CLOSED'));
        });
    });
}

export async function callExtension(target: McpTarget, method: string, params: unknown = {}, timeoutMs = 50000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    const waitForRecovery = typeof target !== 'string' && target.routingGrant !== undefined && method !== 'connection_status';
    const connectDeadline = waitForRecovery ? Math.min(deadline, Date.now() + 3000) : deadline;
    for (;;) {
        try {
            return await dispatch(target, method, params, deadline, connectDeadline);
        } catch (error) {
            if (!waitForRecovery || !(error instanceof BeforeDispatchError) || Date.now() >= connectDeadline) throw error;
            await delay(Math.min(150, connectDeadline - Date.now()));
        }
    }
}
