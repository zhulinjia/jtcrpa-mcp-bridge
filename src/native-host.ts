import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeRoot, instanceFile, sessionEndpoint, type Discovery } from './paths.ts';
import { nativeDecoder, nativeFrame, validInstance, VERSION } from './protocol.ts';
import { METHODS } from './methods.ts';
import { browserBrand, nativeCaller, type BrowserTarget } from './browser-identity.ts';
import { findBinding, rememberInstance, saveRouterSettings, type RouterSettings } from './connections.ts';
import { routerClientConfig } from './install.ts';
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

function parseRouterSettings(value: unknown, caller: BrowserTarget): RouterSettings | undefined {
    if (typeof value !== 'object' || value === null) return;
    const { grantId, label, brand } = value as Record<string, unknown>;
    if ((grantId !== null && !validInstance(grantId)) || typeof label !== 'string' || label.length > 48) return;
    if (brand !== undefined && (!browserBrand(brand) || (caller.kind === 'firefox') !== (brand === 'firefox'))) return;
    return { grantId, label: label.replace(/[\p{C}]/gu, '').trim(), brand };
}

export async function runNativeHost(args: string[]) {
    const caller = nativeCaller(args);
    let record: Discovery | undefined;
    let closeTransport: (() => void) | undefined;
    let claimed = false;
    let closed = false;
    let sequence = 0;
    let routingGrant: string | null = null;
    let routerUpdates = Promise.resolve();
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
    async function claimWhenReleased(current: Discovery) {
        const deadline = Date.now() + 2500;
        while (!closed) {
            try {
                await withRegistrationLock(() => {
                    if (closed) return;
                    if (!fs.existsSync(path.join(bridgeRoot(), 'installation.json'))) throw new Error('HOST_NOT_INSTALLED');
                    claimInstance(current);
                    claimed = true;
                });
                return;
            } catch (error) {
                if (!(error instanceof Error) || error.message !== 'INSTANCE_CONFLICT' || Date.now() >= deadline) throw error;
                // A reloaded extension may open its next native port before the old one closes.
                await delay(100);
            }
        }
    }
    async function routerState(current: Discovery, settings: RouterSettings, requestId?: string) {
        const state = await saveRouterSettings(caller, current.instanceId, settings);
        return { type: 'router_state', grantId: state.grantId, displayName: state.displayName, requestId,
            config: state.bound && state.grantId !== null ? routerClientConfig() : undefined };
    }
    async function start(current: Discovery, settings?: RouterSettings) {
        await claimWhenReleased(current);
        if (closed) return;
        await rememberInstance(caller, current.instanceId);
        const initialRouterState = settings && await routerState(current, settings);
        if (closed) return;
        timer = setTimeout(() => fail('PIPE_HOST_START_TIMEOUT'), 10000);
        closeTransport = listenForClients(current.pipe, {
            ready() {
                clearTimeout(timer);
                if (closed) return;
                send({ type: 'connected', version: VERSION, instanceId: current.instanceId, codexSetup: true });
                if (initialRouterState) send(initialRouterState);
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
                if (request.routingGrant !== undefined) {
                    const binding = validInstance(request.codexBinding) && findBinding(request.codexBinding);
                    if (request.method === 'codex_setup' || request.expectedInstanceId !== current.instanceId || !binding ||
                        binding.instanceId !== current.instanceId || !validInstance(request.routingGrant) ||
                        request.routingGrant !== routingGrant || request.routingGrant !== binding.routing?.grantId) {
                        respond({ ok: false, error: 'ROUTER_ACCESS_REVOKED' });
                        return;
                    }
                }
                if (request.method !== 'codex_setup' && !(METHODS as readonly string[]).includes(request.method ?? '')) {
                    respond({ ok: false, error: 'UNKNOWN_METHOD' });
                    return;
                }
                const id = ++sequence;
                const timeout = setTimeout(() => { pending.delete(id); respond({ ok: false, error: 'EXTENSION_TIMEOUT' }); }, 45000);
                pending.set(id, { respond, timer: timeout });
                send({ type: 'request', version: VERSION, id, method: request.method, params: request.params,
                    expectedInstanceId: request.expectedInstanceId, codexBinding: request.codexBinding, codexAccess: request.codexAccess === true,
                    routingGrant: request.routingGrant });
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
            const settings = parseRouterSettings(msg.router, caller);
            if (msg.router !== undefined && !settings) return fail('INCOMPATIBLE_HANDSHAKE');
            record = current;
            routingGrant = settings?.grantId ?? null;
            void start(current, settings).catch(error => fail(error.message));
            return;
        }
        if (msg?.type === 'router_settings') {
            const settings = parseRouterSettings(msg, caller);
            const requestId = validInstance(msg.requestId) ? msg.requestId : undefined;
            if (!settings) {
                send({ type: 'router_state', grantId: routingGrant, requestId, error: 'INVALID_INPUT' });
                return;
            }
            const current = record;
            routingGrant = settings.grantId;
            routerUpdates = routerUpdates.then(async () => {
                if (!closed) {
                    const reply = await routerState(current, settings, requestId);
                    if (!closed) send(reply);
                }
            }).catch(error => {
                if (!closed) send({ type: 'router_state', grantId: settings.grantId, requestId, error: error.message });
            });
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
