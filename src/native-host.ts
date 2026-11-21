import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { bridgeRoot, instanceFile, sessionEndpoint, type Discovery } from './paths.ts';
import { nativeDecoder, nativeFrame, validInstance, VERSION } from './protocol.ts';
import { METHODS } from './methods.ts';
import { nativeCaller } from './browser-identity.ts';
import { rememberInstance } from './connections.ts';
import { withRegistrationLock } from './registration-lock.ts';
import { listenForClients } from './native-transport.ts';

function claimInstance(record: Discovery): void {
    const file = instanceFile(record.instanceId);
    if (fs.existsSync(file)) {
        const old = JSON.parse(fs.readFileSync(file, 'utf8')) as Discovery;
        let alive = true;
        try { process.kill(old.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) throw new Error('INSTANCE_CONFLICT');
        if (process.platform === 'darwin' && old.pipe === sessionEndpoint(old.session)) {
            fs.rmSync(old.pipe, { force: true });
        }
        fs.unlinkSync(file);
    }
    fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
}

export async function runNativeHost(args: string[]) {
    const caller = nativeCaller(args);
    let record: Discovery | undefined;
    let closeTransport: (() => void) | undefined;
    let claimed = false;
    let closed = false;
    let sequence = 0;
    const pending = new Map<number, { respond: (body: unknown) => void; timer: NodeJS.Timeout }>();
    const send = (value: unknown) => process.stdout.write(nativeFrame(value));
    const fail = (message: string) => {
        if (closed) return;
        send({ type: 'error', error: message });
        cleanup();
        process.exitCode = 1;
        process.stdin.destroy();
    };
    let timer = setTimeout(() => fail('HANDSHAKE_TIMEOUT'), 10000);
    function cleanup() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        for (const item of pending.values()) clearTimeout(item.timer);
        pending.clear();
        closeTransport?.();
        if (record && claimed) {
            try {
                const current = JSON.parse(fs.readFileSync(instanceFile(record.instanceId), 'utf8')) as Discovery;
                if (current.session === record.session) fs.unlinkSync(instanceFile(record.instanceId));
            } catch { /* 已被清理或不存在。 */ }
        }
    }
    async function start(current: Discovery) {
        await withRegistrationLock(() => {
            if (closed) return;
            if (!fs.existsSync(path.join(bridgeRoot(), 'installation.json'))) throw new Error('HOST_NOT_INSTALLED');
            claimInstance(current);
            claimed = true;
        });
        if (closed) return;
        await rememberInstance(caller, current.instanceId);
        if (closed) return;
        timer = setTimeout(() => fail('PIPE_HOST_START_TIMEOUT'), 10000);
        closeTransport = listenForClients(current.pipe, {
            ready() {
                clearTimeout(timer);
                if (!closed) send({ type: 'connected', version: VERSION, instanceId: current.instanceId, codexSetup: true });
            },
            request(request, respond) {
                if (closed) return;
                const supplied = Buffer.from(typeof request?.token === 'string' ? request.token : '');
                const expected = Buffer.from(current.token);
                if (!request || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                    respond({ ok: false, error: 'UNAUTHORIZED' });
                    return;
                }
                if (request.expectedInstanceId !== undefined && (request.expectedInstanceId !== current.instanceId || !validInstance(request.codexBinding))) {
                    respond({ ok: false, error: 'CONNECTION_INSTANCE_MISMATCH' });
                    return;
                }
                if (request.method !== 'codex_setup' && !(METHODS as readonly string[]).includes(request.method ?? '')) {
                    respond({ ok: false, error: 'UNKNOWN_METHOD' });
                    return;
                }
                const id = ++sequence;
                const timeout = setTimeout(() => { pending.delete(id); respond({ ok: false, error: 'EXTENSION_TIMEOUT' }); }, 45000);
                pending.set(id, { respond, timer: timeout });
                send({ type: 'request', version: VERSION, id, method: request.method, params: request.params,
                    expectedInstanceId: request.expectedInstanceId, codexBinding: request.codexBinding, codexAccess: request.codexAccess === true });
            },
            fail,
            closed() { cleanup(); process.stdin.destroy(); },
        });
    }
    process.once('exit', cleanup);
    process.stdin.once('end', cleanup);
    if (process.platform === 'darwin') {
        process.once('SIGTERM', () => { cleanup(); process.stdin.destroy(); });
    }
    const decoder = nativeDecoder(raw => {
        if (closed) return;
        const msg = raw as Record<string, unknown>;
        if (!record) {
            if (msg?.type !== 'hello' || msg.version !== VERSION || !validInstance(msg.instanceId)) return fail('INCOMPATIBLE_HANDSHAKE');
            clearTimeout(timer);
            const session = randomBytes(16).toString('hex');
            const current: Discovery = { version: VERSION, instanceId: msg.instanceId, session, token: randomBytes(32).toString('hex'), pipe: sessionEndpoint(session), pid: process.pid, caller };
            record = current;
            void start(current).catch(error => fail(error.message));
            return;
        }
        if (msg?.type !== 'response' || typeof msg.id !== 'number') return fail('INVALID_RESPONSE');
        const item = pending.get(msg.id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(msg.id);
        item.respond({ ok: msg.ok === true, result: msg.result, error: msg.error });
    });
    process.stdin.on('data', (chunk: Buffer) => { try { decoder(chunk); } catch { fail('INVALID_NATIVE_MESSAGE'); } });
}
