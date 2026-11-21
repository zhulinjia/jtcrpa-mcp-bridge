import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configureServer } from '../dist/codex-client.js';
import { callExtension } from '../dist/ipc.js';
import { connectionName } from '../dist/connections.js';

test('browser display names distinguish identically labelled profiles', () => {
    const chrome = { kind: 'chrome', label: '工作' };
    assert.equal(connectionName({ ...chrome, id: 'c1' }), 'Chrome · c1（工作）');
    assert.equal(connectionName({ ...chrome, id: 'c2' }), 'Chrome · c2（工作）');
    assert.equal(connectionName({ kind: 'firefox', id: 'c3' }), 'Firefox · c3');
});

function isolatedCodex(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-codex 测试-'));
    const originalPath = process.env.PATH;
    const originalHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = directory;
    process.env.PATH = directory + path.delimiter + originalPath;
    t.after(() => {
        process.env.PATH = originalPath;
        if (originalHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalHome;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const catalog = path.join(directory, 'servers.json');
    const calls = path.join(directory, 'calls.jsonl');
    const failure = path.join(directory, 'fail-next');
    const shim = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const script = path.join(directory, 'client.cjs');
    fs.writeFileSync(path.join(directory, shim), process.platform === 'win32'
        ? '@echo off\r\n"' + process.execPath + '" "%~dp0client.cjs" %*\r\n'
        : '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/client.cjs" "$@"\n', { mode: 0o700 });
    fs.writeFileSync(script, `
        const fs = require('node:fs'), args = process.argv.slice(2);
        const file = ${JSON.stringify(catalog)}, rows = JSON.parse(fs.readFileSync(file));
        fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
        const failure = ${JSON.stringify(failure)};
        if (fs.existsSync(failure) && fs.readFileSync(failure, 'utf8') === args[1]) {
            fs.unlinkSync(failure);
            throw new Error('injected failure at ' + args[1]);
        }
        if (args.join(' ') === 'mcp list --json') console.log(JSON.stringify(rows));
        else if (args[0] === 'mcp' && args[1] === 'add' && args[3] === '--') {
            const name = args[2];
            const entry = { name, enabled: true, transport: { type: 'stdio', command: args[4], args: args.slice(5) } };
            fs.writeFileSync(file, JSON.stringify([...rows.filter(row => row.name !== name), entry]));
        } else if (args[0] === 'mcp' && args[1] === 'remove' && args.length === 3) {
            fs.writeFileSync(file, JSON.stringify(rows.filter(row => row.name !== args[2])));
        } else throw new Error('Unexpected Codex invocation: ' + JSON.stringify(args));
    `);
    return {
        read: () => JSON.parse(fs.readFileSync(catalog)),
        seed: rows => fs.writeFileSync(catalog, JSON.stringify(rows)),
        config: contents => fs.writeFileSync(path.join(directory, 'config.toml'), contents),
        calls: () => fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
        failNext: action => fs.writeFileSync(failure, action),
    };
}

test('Codex uses short browser names, preserves collisions and reuses the registered target', t => {
    const client = isolatedCodex(t);
    const a = randomUUID(), b = randomUUID(), aInstance = randomUUID(), bInstance = randomUUID();
    const manual = { name: 'jtcrpa_chrome_c1', enabled: true, transport: { type: 'stdio', command: 'manual', args: [] } };
    const old = { name: 'jtcrpa', enabled: true, transport: { type: 'stdio', command: 'jtcrpa-mcp.cmd', args: ['mcp', '--instance', randomUUID()] } };
    client.seed([manual, old]);
    const first = configureServer(a, aInstance, 'chrome_c1');
    const second = configureServer(b, bInstance, 'chrome_c2');
    assert.equal(second, 'jtcrpa_chrome_c2');
    assert.equal(first, manual.name + '_2');
    assert.equal(configureServer(a, aInstance, 'chrome_c1', first), first);
    const entries = client.read();
    assert.deepEqual(entries.slice(0, 2), [manual, old]);
    assert.equal(entries.length, 4);
    assert.ok(entries[2].enabled && entries[3].enabled);
    assert.equal(entries[3].name, second);
    assert.deepEqual(entries[3].transport.args.slice(-4), ['--connection', b, '--expect-instance', bInstance]);
    assert.equal(configureServer(randomUUID(), randomUUID(), 'firefox_c3'), 'jtcrpa_firefox_c3');
    entries[3].enabled = false;
    client.seed(entries);
    assert.throws(() => configureServer(b, bInstance, 'chrome_c2', second), /已停用/);
    assert.deepEqual(client.read(), entries);
    assert.deepEqual(client.calls().map(args => args[1]), ['list', 'add', 'list', 'add', 'list', 'list', 'add', 'list']);
});

function legacyRegistration(suffix = '', binding = randomUUID()) {
    const instance = randomUUID();
    const base = 'jtcrpa_chrome_c3';
    const name = base + '_' + binding.slice(0, 8) + suffix;
    const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
    const args = [cli, 'mcp', '--connection', binding, '--expect-instance', instance];
    const entry = { name, enabled: true, transport: { type: 'stdio', command: process.execPath, args } };
    const fields = ['command = ' + JSON.stringify(process.execPath), 'args = ' + JSON.stringify(args)];
    const table = '[mcp_servers.' + name + ']\n' + fields.join('\n') + '\n';
    return { name, base, entry, table, fields, register: () => configureServer(binding, instance, 'chrome_c3', name) };
}

test('re-registering migrates the recorded binding, even after an interrupted rename and name collisions', t => {
    const client = isolatedCodex(t);
    const old = legacyRegistration('_2');
    const manual = { name: old.base, enabled: true, transport: { type: 'streamable_http' } };
    const other = { ...old.entry, name: old.name.slice(0, -2), transport: manual.transport };
    client.seed([manual, other, old.entry]);
    client.config(old.table);
    client.failNext('add');
    assert.throws(old.register, /injected failure at add/);
    assert.deepEqual(client.read(), [manual, other, old.entry]);
    client.failNext('remove');
    assert.throws(old.register, /injected failure at remove/);
    const short = { ...old.entry, name: old.base + '_2' };
    assert.deepEqual(client.read(), [manual, other, old.entry, short]);
    // The unrelated owner frees the base name before the retry.
    client.seed([other, old.entry, short]);
    assert.equal(old.register(), short.name);
    assert.deepEqual(client.read(), [other, short]);
    assert.equal(old.register(), short.name);
    assert.deepEqual(client.calls().slice(-3), [['mcp', 'list', '--json'], ['mcp', 'remove', old.name], ['mcp', 'list', '--json']]);
});

test('legacy defaults migrate while custom settings, named tool references and other targets survive', t => {
    const client = isolatedCodex(t);
    // An all-digit binding prefix can also look like a numeric name collision.
    const old = legacyRegistration('', '12345678' + randomUUID().slice(8));
    const disabled = { ...old.entry, enabled: false };
    const inline = old.name + ' = { ' + [...old.fields, 'enabled = false'].join(', ') + ' }\n';
    for (const contents of [old.table + 'enabled = false\n', '[mcp_servers]\n' + inline, 'mcp_servers.' + inline]) {
        client.seed([disabled]);
        client.config(contents);
        assert.equal(old.register(), old.base);
        assert.deepEqual(client.read(), [{ ...old.entry, name: old.base }]);
    }
    for (const [entry, contents] of [
        [old.entry, old.table + 'tool_timeout_sec = 3\n'],
        [old.entry, 'tool = "mcp__' + old.name + '__connection_ping"\n' + old.table],
        [disabled, old.table + 'enabled = false\ndisabled_tools = ["workflow_run"]\n'],
    ]) {
        client.seed([entry]);
        client.config(contents);
        if (entry.enabled) assert.equal(old.register(), old.name);
        else assert.throws(old.register, /已停用/);
        assert.deepEqual(client.read(), [entry]);
    }
    const foreign = { ...old.entry, transport: { type: 'stdio', command: process.execPath, args: ['other'] } };
    client.seed([foreign]);
    client.config(old.table);
    assert.equal(old.register(), old.base);
    assert.deepEqual(client.read(), [foreign, { ...old.entry, name: old.base }]);
});

test('a removed or reassigned binding is rejected before a browser operation is dispatched', async t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-binding-'));
    const original = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = home;
    t.after(() => {
        if (original === undefined) delete process.env.JTCRPA_BRIDGE_HOME; else process.env.JTCRPA_BRIDGE_HOME = original;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const bindingId = randomUUID(), expectedInstanceId = randomUUID();
    await assert.rejects(callExtension({ bindingId, expectedInstanceId }, 'workflow_run'), /CONNECTION_REMOVED/);
    fs.writeFileSync(path.join(home, 'connections.json'), JSON.stringify({ nextId: 2, observed: [], connections: [
        { id: 'c1', bindingId, kind: 'chrome', extensionId: 'a'.repeat(32), instanceId: randomUUID() },
    ] }));
    await assert.rejects(callExtension({ bindingId, expectedInstanceId }, 'workflow_run'), /CONNECTION_INSTANCE_MISMATCH/);
});
