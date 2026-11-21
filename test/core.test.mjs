import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeFrame, nativeDecoder, MAX_BYTES } from '../dist/protocol.js';
import { callExtension } from '../dist/ipc.js';
import { bridgeRoot, instanceFile, readDiscovery } from '../dist/paths.js';
import { manageHostRegistration } from '../dist/install.js';
import { verifySdkConnection } from '../test-support/sdk-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
test('Native Messaging handles split UTF-8 frames and rejects invalid sizes', () => {
    const values = [];
    const feed = nativeDecoder((value) => values.push(value));
    const packet = nativeFrame({ text: '中文' });
    for (const byte of packet) feed(Buffer.from([byte]));
    assert.deepEqual(values, [{ text: '中文' }]);
    const invalid = Buffer.alloc(4); invalid.writeUInt32LE(MAX_BYTES + 1);
    assert.throws(() => feed(invalid), /INVALID_FRAME_SIZE/);
});

for (const kind of process.platform === 'darwin' ? ['chrome', 'firefox'] : ['chrome']) {
    test(`${kind} native host routes concurrent requests and cleans discovery on EOF`, { timeout: 30000 }, t => verifyNativeHost(t, kind));
}

async function verifyNativeHost(t, kind) {
    const mac = process.platform === 'darwin';
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-bridge-test-'));
    const previous = process.env.JTCRPA_BRIDGE_HOME;
    t.after(() => {
        if (previous === undefined) delete process.env.JTCRPA_BRIDGE_HOME; else process.env.JTCRPA_BRIDGE_HOME = previous;
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    const extensionId = kind === 'chrome' ? 'a'.repeat(32) : 'test@example.com';
    const id = randomUUID();
    let bindingId;
    let child;
    if (mac) {
        t.mock.method(os, 'homedir', () => path.join(temporary, "用户's home"));
        delete process.env.JTCRPA_BRIDGE_HOME;
        await manageHostRegistration('add', ['--' + kind + '-id', extensionId]);
        const vendor = kind === 'chrome' ? 'Google/Chrome' : 'Mozilla';
        const manifest = path.join(os.homedir(), 'Library/Application Support', vendor, 'NativeMessagingHosts/com.jtcrpa.mcp.json');
        const { path: launcher } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const args = kind === 'chrome' ? [`chrome-extension://${extensionId}/`] : [manifest, extensionId];
        child = spawn(launcher, args, { env: { PATH: '/usr/bin:/bin' } });
    } else {
        process.env.JTCRPA_BRIDGE_HOME = temporary;
        fs.mkdirSync(path.join(temporary, 'instances'));
        fs.writeFileSync(path.join(temporary, 'installation.json'), '{}');
        bindingId = randomUUID();
        fs.writeFileSync(path.join(temporary, 'connections.json'), JSON.stringify({ nextId: 2, connections: [
            { id: 'c1', bindingId, kind, extensionId, instanceId: id },
        ], observed: [] }));
        execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(here, '../windows/secure-directory.ps1'), '-Directory', temporary], { windowsHide: true });
        child = spawn(process.execPath, [path.resolve(here, '../bin/cli.mjs'), 'native-host', `chrome-extension://${extensionId}/`], { env: process.env, windowsHide: true });
    }
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const ready = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error(stderr)));
        const decode = nativeDecoder((message) => {
            if (message.type === 'error') reject(new Error(message.error));
            if (message.type === 'connected') resolve();
            if (message.type === 'request') {
                const result = message.method === 'connection_status'
                    ? { instanceId: id, connected: true }
                    : { instanceId: id, text: message.params.text };
                child.stdin.write(nativeFrame({ type: 'response', version: 1, id: message.id, ok: true, result }));
            }
        });
        child.stdout.on('data', decode);
    });
    try {
        child.stdin.write(nativeFrame({ type: 'hello', version: 1, instanceId: id }));
        await ready;
        if (mac) await manageHostRegistration('add', ['--' + kind + '-id', extensionId, '--instance', id]);
        const { listConnections } = await import('../dist/connections.js');
        const [connected] = listConnections().connections;
        bindingId ??= connected.bindingId;
        if (mac) await verifySdkConnection(id, true, bridgeRoot());
        assert.deepEqual(connected.candidates, [{ instanceId: id, online: true }]);
        assert.equal((await callExtension({ bindingId }, 'connection_ping', { text: '稳定绑定' })).text, '稳定绑定');
        const results = await Promise.all(['中文', 'two', 'three'].map((text) => callExtension(id, 'connection_ping', { text })));
        assert.deepEqual(results.map((result) => result.text), ['中文', 'two', 'three']);
        for (let batch = 0; batch < 8; batch++) {
            const messages = Array.from({ length: 7 }, (_, n) => `batch-${batch}-${n}`);
            const replies = await Promise.all(messages.map(text => callExtension(id, 'connection_ping', { text })));
            assert.deepEqual(replies.map(reply => reply.text), messages);
        }
        assert.ok(fs.existsSync(instanceFile(id)));
        const record = JSON.parse(fs.readFileSync(instanceFile(id), 'utf8'));
        if (mac) {
            assert.equal(fs.statSync(record.pipe).mode & 0o777, 0o600);
            assert.equal(fs.statSync(path.dirname(record.pipe)).mode & 0o777, 0o700);
            assert.equal(fs.statSync(instanceFile(id)).mode & 0o777, 0o600);
            fs.writeFileSync(instanceFile(id), JSON.stringify({ ...record, pipe: '/tmp/other.sock' }));
            assert.throws(() => readDiscovery(id), /INVALID_DISCOVERY/);
            fs.writeFileSync(instanceFile(id), JSON.stringify(record));
        } else {
            const pipeName = record.pipe.split('\\').at(-1);
            assert.match(pipeName, /^jtcrpa-mcp-[a-f0-9]{32}$/);
            const script = `$p=New-Object System.IO.Pipes.NamedPipeClientStream('.', '${pipeName}', [System.IO.Pipes.PipeDirection]::InOut); $p.Connect(3000); $p.GetAccessControl().GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access); $p.Dispose()`;
            const acl = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
            assert.match(acl, /D;[^)]*;;;NU/);
            assert.doesNotMatch(acl, /;;;WD/);
        }
        const unauthorized = await new Promise((resolve, reject) => {
            const socket = net.createConnection(record.pipe, () => socket.write(JSON.stringify({ token: 'wrong', method: 'connection_status' }) + '\n'));
            socket.on('error', reject);
            let text = '';
            socket.on('data', (chunk) => { text += chunk; if (text.includes('\n')) { resolve(JSON.parse(text)); socket.destroy(); } });
        });
        assert.deepEqual(unauthorized, { ok: false, error: 'UNAUTHORIZED' });
        await assert.rejects(callExtension(id, 'invalid'), /UNKNOWN_METHOD/);
        child.stdin.end();
        await exited;
        assert.equal(fs.existsSync(instanceFile(id)), false);
        if (mac) assert.equal(fs.existsSync(record.pipe), false);
        const [offline] = listConnections().connections;
        assert.equal(offline.instanceId, id);
        assert.equal(offline.status, 'offline');
    } finally {
        child.kill();
    }
}
