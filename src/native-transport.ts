import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES } from './protocol.ts';

type Respond = (body: unknown) => void;
interface Listener {
    ready(): void;
    request(value: { token?: string; method?: string; params?: unknown; expectedInstanceId?: string;
        codexBinding?: string; codexAccess?: boolean; routingGrant?: string } | null, respond: Respond): void;
    fail(message: string): void;
    closed(): void;
}

export function listenForClients(endpoint: string, listener: Listener): () => void {
    if (process.platform === 'darwin') return listenOnSocket(endpoint, listener);

    const script = fileURLToPath(new URL('../windows/pipe-server.ps1', import.meta.url));
    const pipeName = endpoint.slice(endpoint.lastIndexOf('\\') + 1);
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PipeName', pipeName], { windowsHide: true });
    helper.stderr.on('data', chunk => process.stderr.write(chunk));
    helper.on('error', () => listener.fail('PIPE_HOST_START_FAILED'));
    helper.stdin.on('error', () => listener.fail('PIPE_HOST_CLOSED'));
    helper.on('exit', listener.closed);
    readline.createInterface({ input: helper.stdout }).on('line', line => {
        try {
            if (Buffer.byteLength(line) > MAX_BYTES) return listener.fail('MESSAGE_TOO_LARGE');
            const value = JSON.parse(line);
            if (value.ready) listener.ready();
            else listener.request(value.request, body => {
                helper.stdin.write(JSON.stringify({ clientId: value.clientId, body }) + '\n');
            });
        } catch { listener.fail('INVALID_IPC_MESSAGE'); }
    });
    return () => helper.stdin.end();
}

function listenOnSocket(endpoint: string, listener: Listener): () => void {
    const clients = new Set<net.Socket>();
    const server = net.createServer(socket => {
        clients.add(socket);
        socket.once('close', () => clients.delete(socket));
        socket.on('error', () => socket.destroy());
        socket.setTimeout(55000, () => socket.destroy());
        const chunks: Buffer[] = [];
        let bytes = 0;
        socket.on('data', (chunk: Buffer) => {
            const end = chunk.indexOf(10);
            const part = end < 0 ? chunk : chunk.subarray(0, end);
            bytes += part.length;
            if (bytes >= MAX_BYTES) { socket.destroy(); return; }
            chunks.push(part);
            if (end < 0) return;
            socket.pause(); // Each connection carries one newline-delimited request.
            try {
                const request = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
                listener.request(request, body => socket.end(JSON.stringify(body) + '\n'));
            } catch { socket.destroy(); }
        });
    });
    server.maxConnections = 32;
    server.on('error', () => listener.fail('PIPE_HOST_START_FAILED'));
    server.listen(endpoint, () => {
        try {
            fs.chmodSync(endpoint, 0o600);
            listener.ready();
        } catch { listener.fail('PIPE_HOST_START_FAILED'); }
    });
    return () => {
        server.close();
        for (const client of clients) client.destroy();
    };
}
