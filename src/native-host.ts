import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import readline from 'node:readline';
import { bridgeRoot, instanceFile, type Discovery } from './paths.ts';
import { MAX_BYTES, nativeDecoder, nativeFrame, validInstance, VERSION } from './protocol.ts';
import { METHODS } from './methods.ts';

export async function runNativeHost() {
    let helper: ChildProcessWithoutNullStreams | undefined;
    let record: Discovery | undefined;
    let claimed = false;
    let helloTimer: NodeJS.Timeout | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    let sequence = 0;
    const pending = new Map<number, { clientId: number; timer: NodeJS.Timeout }>();
    const send = (value: unknown) => process.stdout.write(nativeFrame(value));
    const respond = (clientId: number, body: unknown) => helper?.stdin.write(JSON.stringify({ clientId, body }) + '\n');
    const fail = (message: string) => { send({ type: 'error', error: message }); cleanup(); helper?.kill(); process.exitCode = 1; process.stdin.destroy(); };
    function cleanup() {
        clearTimeout(helloTimer); clearTimeout(startupTimer);
        for (const item of pending.values()) clearTimeout(item.timer);
        pending.clear();
        helper?.stdin.end();
        if (record && claimed) {
            try {
                const current = JSON.parse(fs.readFileSync(instanceFile(record.instanceId), 'utf8')) as Discovery;
                if (current.session === record.session) fs.unlinkSync(instanceFile(record.instanceId));
            } catch { /* 已被清理或不存在。 */ }
        }
    }
    process.once('exit', cleanup);
    process.stdin.once('end', () => { cleanup(); });
    helloTimer = setTimeout(() => fail('HANDSHAKE_TIMEOUT'), 10000);
    const decoder = nativeDecoder((raw) => {
        const msg = raw as Record<string, unknown>;
        if (!record) {
            clearTimeout(helloTimer);
            if (msg?.type !== 'hello' || msg.version !== VERSION || !validInstance(msg.instanceId)) return fail('INCOMPATIBLE_HANDSHAKE');
            const root = bridgeRoot();
            if (!fs.existsSync(path.join(root, 'installation.json'))) return fail('HOST_NOT_INSTALLED');
            const session = randomBytes(16).toString('hex');
            record = { version: VERSION, instanceId: msg.instanceId, session, token: randomBytes(32).toString('hex'), pipe: `\\\\.\\pipe\\jtcrpa-mcp-${session}`, pid: process.pid };
            const file = instanceFile(record.instanceId);
            try {
                if (fs.existsSync(file)) {
                    const old = JSON.parse(fs.readFileSync(file, 'utf8')) as Discovery;
                    let alive = true;
                    try { process.kill(old.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
                    if (alive) return fail('INSTANCE_CONFLICT');
                    fs.unlinkSync(file);
                }
                fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx' });
                claimed = true;
            } catch { return fail('INSTANCE_CONFLICT'); }
            const script = fileURLToPath(new URL('../windows/pipe-server.ps1', import.meta.url));
            helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PipeName', `jtcrpa-mcp-${session}`], { windowsHide: true });
            startupTimer = setTimeout(() => fail('PIPE_HOST_START_TIMEOUT'), 10000);
            helper.stderr.on('data', (chunk) => process.stderr.write(chunk));
            helper.on('error', () => fail('PIPE_HOST_START_FAILED'));
            helper.on('exit', () => { cleanup(); process.stdin.destroy(); });
            readline.createInterface({ input: helper.stdout }).on('line', (line) => {
                try {
                    if (Buffer.byteLength(line) > MAX_BYTES) return fail('MESSAGE_TOO_LARGE');
                    const value = JSON.parse(line) as { ready?: boolean; clientId: number; request: { token?: string; method?: string; params?: unknown } };
                    if (value.ready) { clearTimeout(startupTimer); send({ type: 'connected', version: VERSION, instanceId: record!.instanceId }); return; }
                    const supplied = Buffer.from(value.request.token ?? '');
                    const expected = Buffer.from(record!.token);
                    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { respond(value.clientId, { ok: false, error: 'UNAUTHORIZED' }); return; }
                    if (!(METHODS as readonly string[]).includes(value.request.method ?? '')) { respond(value.clientId, { ok: false, error: 'UNKNOWN_METHOD' }); return; }
                    const id = ++sequence;
                    const timer = setTimeout(() => { pending.delete(id); respond(value.clientId, { ok: false, error: 'EXTENSION_TIMEOUT' }); }, 45000);
                    pending.set(id, { clientId: value.clientId, timer });
                    send({ type: 'request', version: VERSION, id, method: value.request.method, params: value.request.params });
                } catch { fail('INVALID_IPC_MESSAGE'); }
            });
            return;
        }
        if (msg?.type !== 'response' || typeof msg.id !== 'number') return fail('INVALID_RESPONSE');
        const item = pending.get(msg.id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(msg.id);
        respond(item.clientId, { ok: msg.ok === true, result: msg.result, error: msg.error });
    });
    process.stdin.on('data', (chunk: Buffer) => { try { decoder(chunk); } catch { fail('INVALID_NATIVE_MESSAGE'); } });
}
