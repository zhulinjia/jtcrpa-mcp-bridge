import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { callExtension } from '../dist/ipc.js';
import { connectionFile, readConnections, saveRouterSettings } from '../dist/connections.js';
import { instanceFile, sessionEndpoint } from '../dist/paths.js';
import { nativeDecoder, nativeFrame, VERSION } from '../dist/protocol.js';
import { canListenLocally } from '../test-support/native-ipc.mjs';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const extensionId = 'a'.repeat(32);

function startHost(t, instanceId, grantId) {
    const child = spawn(process.execPath, [cli, 'native-host', `chrome-extension://${extensionId}/`], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'],
    });
    const messages = [];
    const exit = new Promise(resolve => child.once('exit', resolve));
    t.after(async () => { child.kill(); await exit; });
    const send = message => child.stdin.write(nativeFrame(message));
    child.stdout.on('data', nativeDecoder(message => messages.push(message)));
    send({ type: 'hello', version: VERSION, instanceId, extensionVersion: '9.9.9',
        router: { grantId, label: '测试配置', brand: 'edge' } });
    async function next(type) {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
            const index = messages.findIndex(message => message.type === type);
            if (index !== -1) return messages.splice(index, 1)[0];
            if (child.exitCode !== null) throw new Error(`Native host exited before ${type}: ${JSON.stringify(messages)}`);
            await delay(25);
        }
        throw new Error(`Native host did not return ${type}: ${JSON.stringify(messages)}`);
    }
    return {
        next,
        messages,
        reply: (message, result) => send({ type: 'response', id: message.id, ok: true, result }),
        stop: async () => { child.stdin.end(); await exit; },
    };
}

function isolatedRoute(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-native-router-'));
    const original = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = root;
    t.after(() => {
        if (original === undefined) delete process.env.JTCRPA_BRIDGE_HOME; else process.env.JTCRPA_BRIDGE_HOME = original;
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'instances'));
    fs.writeFileSync(path.join(root, 'installation.json'), '{}');
    const instanceId = randomUUID(), bindingId = randomUUID(), grantId = randomUUID();
    const target = { bindingId, expectedInstanceId: instanceId, routingGrant: grantId };
    fs.writeFileSync(path.join(root, 'connections.json'), JSON.stringify({ nextId: 2, observed: [], connections: [
        { id: 'c1', bindingId, kind: 'chrome', extensionId, instanceId, routing: { grantId, label: '测试配置' } },
    ] }));
    return { instanceId, grantId, target };
}

test('router hands over after old native host releases, never replays a dispatched write, and rejects a live duplicate', {
    skip: !['darwin', 'win32'].includes(process.platform), timeout: 30_000,
}, async t => {
    if (!await canListenLocally(t)) return;
    const { instanceId, grantId, target } = isolatedRoute(t);
    const old = startHost(t, instanceId, grantId);
    // Wait for the initial host separately so Windows PowerShell cold startup
    // does not consume the recovery window for a later session handoff.
    await old.next('connected');
    const initialPing = callExtension(target, 'connection_ping', { text: 'old session' });
    const ping = await old.next('request');
    assert.equal(ping.routingGrant, grantId);
    old.reply(ping, ping.params.text);
    assert.equal(await initialPing, 'old session');

    // Start the replacement during the upgrade while the old port is still live.
    const replacement = startHost(t, instanceId, grantId);
    await delay(350);
    assert.equal(replacement.messages.some(message => message.type === 'connected'), false);
    const write = callExtension(target, 'workflow_run', { workflowId: 7, requestId: randomUUID() });
    const interrupted = assert.rejects(write, /BRIDGE_CLOSED|ECONNRESET|EPIPE/);
    const dispatched = await old.next('request');
    assert.equal(dispatched.method, 'workflow_run');
    await old.stop();
    await interrupted;
    await replacement.next('connected');

    const status = callExtension(target, 'connection_status', {}, 1500);
    const statusRequest = await replacement.next('request');
    assert.equal(statusRequest.method, 'connection_status');
    replacement.reply(statusRequest, { connected: true });
    assert.deepEqual(await status, { connected: true });

    const duplicate = startHost(t, instanceId, randomUUID());
    assert.equal((await duplicate.next('error')).error, 'INSTANCE_CONFLICT');
    const stillOriginal = callExtension(target, 'connection_ping', { text: 'original' });
    const stillOriginalRequest = await replacement.next('request');
    assert.equal(stillOriginalRequest.method, 'connection_ping');
    replacement.reply(stillOriginalRequest, stillOriginalRequest.params.text);
    assert.equal(await stillOriginal, 'original');
    await replacement.stop();
});

test('router retries only before dispatch, then preserves an unknown write outcome', async t => {
    const { instanceId, grantId, target } = isolatedRoute(t);
    const received = [];
    class TestSocket extends EventEmitter {
        write(value) {
            const request = JSON.parse(value);
            received.push(request);
            queueMicrotask(() => {
                if (request.method === 'workflow_run') {
                    this.emit('end');
                    this.destroy();
                } else {
                    this.emit('data', Buffer.from(JSON.stringify({ ok: true, result: request.params.text }) + '\n'));
                }
            });
        }
        destroy(error) {
            if (error) this.emit('error', error);
            this.emit('close');
        }
    }
    const connection = t.mock.method(net, 'createConnection', () => {
        const socket = new TestSocket();
        queueMicrotask(() => socket.emit('connect'));
        return socket;
    });
    const pending = callExtension(target, 'connection_ping', { text: 'restored' }, 1000);
    await delay(75);
    assert.equal(connection.mock.callCount(), 0);
    const session = randomBytes(16).toString('hex');
    fs.writeFileSync(instanceFile(instanceId), JSON.stringify({ version: 1, instanceId, pid: process.pid,
        session, pipe: sessionEndpoint(session), token: randomBytes(32).toString('hex'), caller: { kind: 'chrome', extensionId } }));
    assert.equal(await pending, 'restored');
    assert.equal(received[0].routingGrant, grantId);
    await assert.rejects(callExtension(target, 'workflow_run', { workflowId: 7, requestId: randomUUID() }, 1000), /BRIDGE_CLOSED/);
    assert.equal(connection.mock.callCount(), 2);
    assert.deepEqual(received.map(request => request.method), ['connection_ping', 'workflow_run']);
});

test('router settings retain the browser name and write only the matching instance grant', async t => {
    const { instanceId, grantId } = isolatedRoute(t);
    const caller = { kind: 'chrome', extensionId };
    const other = { ...caller, id: 'c2', instanceId: randomUUID(), bindingId: randomUUID() };
    const otherGrant = { grantId: randomUUID(), label: '店铺 B', brand: 'chrome' };
    const store = readConnections();
    store.connections.push(other);
    fs.writeFileSync(connectionFile(), JSON.stringify(store));

    const settings = { grantId, label: '店铺 A', brand: 'edge' };
    assert.deepEqual(await saveRouterSettings(caller, instanceId, settings), {
        grantId, bound: true, displayName: 'Edge · 店铺 A',
    });
    await saveRouterSettings(caller, other.instanceId, otherGrant);
    await saveRouterSettings(caller, instanceId, { ...settings, grantId: null });
    assert.deepEqual(readConnections().connections.map(item => item.routing), [undefined, otherGrant]);

    const renewed = { ...settings, grantId: randomUUID() };
    await saveRouterSettings(caller, instanceId, renewed);
    assert.deepEqual(readConnections().connections.map(item => item.routing), [renewed, otherGrant]);
});
