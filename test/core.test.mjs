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
import { instanceFile } from '../dist/paths.js';

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

test('real protected pipe routes concurrent requests and cleans discovery on EOF', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-bridge-test-'));
    const previous = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = root;
    fs.mkdirSync(path.join(root, 'instances'));
    fs.writeFileSync(path.join(root, 'installation.json'), '{}');
    const extensionId = 'a'.repeat(32);
    const id = randomUUID();
    const bindingId = randomUUID();
    fs.writeFileSync(path.join(root, 'connections.json'), JSON.stringify({ nextId: 2, connections: [
        { id: 'c1', bindingId, kind: 'chrome', extensionId, instanceId: id },
    ], observed: [] }));
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(here, '../windows/secure-directory.ps1'), '-Directory', root], { windowsHide: true });
    const child = spawn(process.execPath, [path.resolve(here, '../bin/cli.mjs'), 'native-host', `chrome-extension://${extensionId}/`], { env: process.env, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const ready = new Promise((resolve, reject) => {
        child.once('exit', () => reject(new Error(stderr)));
        const decode = nativeDecoder((message) => {
            if (message.type === 'error') reject(new Error(message.error));
            if (message.type === 'connected') resolve();
            if (message.type === 'request') child.stdin.write(nativeFrame({ type: 'response', version: 1, id: message.id, ok: true, result: { instanceId: id, text: message.params.text } }));
        });
        child.stdout.on('data', decode);
    });
    try {
        child.stdin.write(nativeFrame({ type: 'hello', version: 1, instanceId: id }));
        await ready;
        const { listConnections } = await import('../dist/connections.js');
        const [connected] = listConnections().connections;
        assert.deepEqual(connected.candidates, [{ instanceId: id, online: true }]);
        assert.equal((await callExtension({ bindingId }, 'connection_ping', { text: '稳定绑定' })).text, '稳定绑定');
        const results = await Promise.all(['中文', 'two', 'three'].map((text) => callExtension(id, 'connection_ping', { text })));
        assert.deepEqual(results.map((result) => result.text), ['中文', 'two', 'three']);
        assert.ok(fs.existsSync(instanceFile(id)));
        const record = JSON.parse(fs.readFileSync(instanceFile(id), 'utf8'));
        const pipeName = record.pipe.split('\\').at(-1);
        assert.match(pipeName, /^jtcrpa-mcp-[a-f0-9]{32}$/);
        const script = `$p=New-Object System.IO.Pipes.NamedPipeClientStream('.', '${pipeName}', [System.IO.Pipes.PipeDirection]::InOut); $p.Connect(3000); $p.GetAccessControl().GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access); $p.Dispose()`;
        const acl = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
        assert.match(acl, /D;[^)]*;;;NU/);
        assert.doesNotMatch(acl, /;;;WD/);
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
        const [offline] = listConnections().connections;
        assert.equal(offline.instanceId, id);
        assert.equal(offline.status, 'offline');
    } finally {
        child.kill();
        if (previous === undefined) delete process.env.JTCRPA_BRIDGE_HOME; else process.env.JTCRPA_BRIDGE_HOME = previous;
        const resolved = fs.realpathSync(root);
        assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('jtcrpa-bridge-test-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
