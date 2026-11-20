import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { manageHostRegistration, removeConnection, clientConfig } from '../dist/install.js';
import { listConnections, rememberInstance } from '../dist/connections.js';
import { instanceFile } from '../dist/paths.js';
import { nativeCaller } from '../dist/browser-identity.js';
import { randomUUID } from 'node:crypto';
import { callExtension } from '../dist/ipc.js';
import { HOST } from '../dist/protocol.js';

const chromeId = 'a'.repeat(32);
const firefoxId = 'test@example.com';
const bothBrowsers = ['--chrome-id', chromeId, '--firefox-id', firefoxId];
const chromeKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;
const firefoxKey = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST}`;
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

// 文件使用隔离目录，注册表与权限脚本均用桩替代，不触碰真实宿主注册。
function isolatedInstallation(t, { failRegistry, failDirectory } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-install-test-'));
    const previousHome = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = root;
    const registry = new Map();
    const commands = [];
    const messages = [];
    t.mock.method(console, 'log', (message) => messages.push(message));
    t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
        assert.equal(command, 'powershell.exe');
        assert.equal(options.windowsHide, true);
        assert.equal(args.at(-1), root);
        if (failDirectory) throw new Error('Directory permissions failed');
        return Buffer.alloc(0);
    });
    t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
        assert.equal(options.windowsHide, true);
        if (command === 'powershell.exe') {
            assert.ok(args[args.indexOf('-File') + 1].endsWith('read-registration.ps1'));
            const key = 'HKCU\\' + args[args.indexOf('-RegistryPath') + 1];
            commands.push(['query', key]);
            return { status: 0, stdout: JSON.stringify(registry.get(key) ?? null), stderr: '' };
        }
        assert.equal(command, 'reg.exe');
        commands.push(args);
        const failure = failRegistry?.(args);
        if (failure) return { status: 1, stdout: '', stderr: failure };
        const [action, key] = args;
        if (action === 'query') {
            if (!registry.has(key)) return { status: 1, stdout: '', stderr: 'Not found' };
            return { status: 0, stdout: `    (Default)    REG_SZ    ${registry.get(key)}\r\n`, stderr: '' };
        }
        if (action === 'add') registry.set(key, args[args.indexOf('/d') + 1]);
        if (action === 'delete') registry.delete(key);
        return { status: 0, stdout: '', stderr: '' };
    });
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
        if (previousHome === undefined) delete process.env.JTCRPA_BRIDGE_HOME;
        else process.env.JTCRPA_BRIDGE_HOME = previousHome;
        const resolved = fs.realpathSync(root);
        assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('jtcrpa-install-test-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return {
        root, registry, commands, messages,
        file: (name) => path.join(root, name),
        read: (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')),
    };
}

function installedFiles(fixture) {
    return ['host.cmd', 'installation.json', 'chrome.json', 'firefox.json', 'connections.json'].map((name) => {
        const file = fixture.file(name);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    });
}

test('add writes exact launcher and browser-specific manifests, then uninstall removes owned registration', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    assert.equal(fs.readFileSync(fixture.file('host.cmd'), 'utf8'), `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host "%~1" "%~2"\r\n`);
    assert.deepEqual(fixture.read('installation.json'), { kinds: ['chrome', 'firefox'], node: process.execPath, cli });
    const common = { name: HOST, description: 'Jiutouchong MCP bridge', path: fixture.file('host.cmd'), type: 'stdio' };
    assert.deepEqual(fixture.read('chrome.json'), { ...common, allowed_origins: [`chrome-extension://${chromeId}/`] });
    assert.deepEqual(fixture.read('firefox.json'), { ...common, allowed_extensions: [firefoxId] });
    assert.equal(fixture.registry.get(chromeKey), fixture.file('chrome.json'));
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
    await manageHostRegistration('uninstall', []);
    assert.equal(fixture.registry.size, 0);
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.deepEqual(fixture.messages, ['Native host registered for chrome, firefox', 'Native host unregistered.']);
});

test('add preserves earlier IDs, the other browser and registration order', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', ['--firefox-id', firefoxId]);
    const firefoxManifest = fs.readFileSync(fixture.file('firefox.json'), 'utf8');
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    await manageHostRegistration('add', ['--chrome-id', 'b'.repeat(32)]);
    assert.deepEqual(fixture.read('installation.json').kinds, ['firefox', 'chrome']);
    assert.equal(fs.readFileSync(fixture.file('firefox.json'), 'utf8'), firefoxManifest);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, [`chrome-extension://${chromeId}/`, `chrome-extension://${'b'.repeat(32)}/`]);
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
});

test('repeated add with a live connection only reads the existing registration', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    fs.writeFileSync(fixture.file(`instances/${'e'.repeat(64)}.json`), JSON.stringify({ pid: process.pid, instanceId: 'online' }));
    const before = installedFiles(fixture);
    fixture.commands.length = 0;
    t.mock.method(fs, 'renameSync', () => assert.fail('Repeated add rewrote a file'));
    await manageHostRegistration('add', bothBrowsers);
    assert.deepEqual(installedFiles(fixture), before);
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
    assert.equal(fixture.messages.at(-1), 'Native host already registered for chrome, firefox');
});

test('concurrent additions keep distinct IDs once and preserve a live native host', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    const instanceFile = fixture.file(`instances/${'f'.repeat(64)}.json`);
    fs.writeFileSync(instanceFile, JSON.stringify({ pid: process.pid, instanceId: 'online' }));
    const newChrome = 'b'.repeat(32);
    const newFirefox = 'second@example.com';
    await Promise.all([
        manageHostRegistration('add', ['--chrome-id', newChrome]),
        manageHostRegistration('add', ['--firefox-id', newFirefox]),
        manageHostRegistration('add', ['--chrome-id', newChrome]),
    ]);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, [`chrome-extension://${chromeId}/`, `chrome-extension://${newChrome}/`]);
    assert.deepEqual(fixture.read('firefox.json').allowed_extensions, [firefoxId, newFirefox]);
    assert.equal(fs.existsSync(instanceFile), true);
});

test('invalid extension arguments fail before files or registration are changed', async (t) => {
    const fixture = isolatedInstallation(t);
    const cases = [
        [[], 'Provide --chrome-id or --firefox-id with the installed extension ID.'],
        [['--chrome-id', 'invalid'], 'Invalid Chrome extension ID'],
        [['--firefox-id', 'invalid/id'], 'Invalid Firefox extension ID'],
    ];
    for (const [args, message] of cases) {
        await assert.rejects(manageHostRegistration('add', args), { message });
    }
    await assert.rejects(manageHostRegistration('add', ['--chrome-id']), /chrome-id/);
    await assert.rejects(manageHostRegistration('add', ['--chrome-id', chromeId, '--wrong']), /wrong/);
    assert.deepEqual(fs.readdirSync(fixture.root), []);
    assert.deepEqual(fixture.commands, []);
});

test('add refuses to overwrite another installation', async (t) => {
    const fixture = isolatedInstallation(t);
    fixture.registry.set(chromeKey, fixture.file('another-host.json'));
    await assert.rejects(manageHostRegistration('add', bothBrowsers), /A different chrome host is registered/);
    assert.equal(fixture.registry.get(chromeKey), fixture.file('another-host.json'));
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
});

test('active instance prevents replacing the launcher and uninstalling', async (t) => {
    const fixture = isolatedInstallation(t);
    fs.mkdirSync(fixture.file('instances'));
    fs.writeFileSync(fixture.file(`instances/${'a'.repeat(64)}.json`), JSON.stringify({ pid: process.pid, instanceId: 'online' }));
    await assert.rejects(manageHostRegistration('add', bothBrowsers), { message: 'Disable MCP before changing the native host launcher.' });
    await assert.rejects(manageHostRegistration('uninstall', []), { message: 'Disable MCP in the browser before uninstalling.' });
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
});

test('permission preparation failure does not write host files or registry', async (t) => {
    const fixture = isolatedInstallation(t, { failDirectory: true });
    await assert.rejects(manageHostRegistration('add', bothBrowsers), { message: 'Directory permissions failed' });
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
});

test('failed second registration removes the first registration and new host files', async (t) => {
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action, key]) => action === 'add' && key === firefoxKey ? 'Registration denied' : undefined,
    });
    await assert.rejects(manageHostRegistration('add', bothBrowsers), { message: 'Host registration failed: Registration denied' });
    assert.equal(fixture.registry.size, 0);
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.deepEqual(fixture.messages, []);
});

test('failed upgrade restores existing file bytes and registrations', async (t) => {
    let failUpdate = false;
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action, key]) => failUpdate && action === 'add' && key === firefoxKey ? 'Update denied' : undefined,
    });
    await manageHostRegistration('add', bothBrowsers);
    fixture.registry.delete(firefoxKey);
    const before = installedFiles(fixture);
    const registrations = new Map(fixture.registry);
    failUpdate = true;
    await assert.rejects(manageHostRegistration('add', ['--chrome-id', 'c'.repeat(32), '--firefox-id', 'new@example.com']), /Update denied/);
    assert.deepEqual(installedFiles(fixture), before);
    assert.deepEqual(fixture.registry, registrations);
});

test('file write failure restores prior files before reporting the error', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    const before = installedFiles(fixture);
    const originalRename = fs.renameSync;
    let failed = false;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (to === fixture.file('firefox.json') && !failed) {
            failed = true;
            throw new Error('Manifest write failed');
        }
        return originalRename(from, to);
    });
    const additions = ['--chrome-id', 'c'.repeat(32), '--firefox-id', 'new@example.com'];
    await assert.rejects(manageHostRegistration('add', additions), { message: 'Manifest write failed' });
    assert.equal(failed, true);
    assert.deepEqual(installedFiles(fixture), before);
    assert.equal(fixture.registry.get(chromeKey), fixture.file('chrome.json'));
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
});

test('uninstall preserves a registration taken over by another installation', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    fixture.registry.set(chromeKey, fixture.file('another-host.json'));
    await manageHostRegistration('uninstall', []);
    assert.deepEqual(fixture.registry, new Map([[chromeKey, fixture.file('another-host.json')]]));
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
});

test('uninstall reports registry removal failure and leaves that host recoverable', async (t) => {
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action]) => action === 'delete' ? 'Removal denied' : undefined,
    });
    await manageHostRegistration('add', bothBrowsers);
    const before = installedFiles(fixture);
    await assert.rejects(manageHostRegistration('uninstall', []), { message: 'Removal denied' });
    assert.deepEqual(installedFiles(fixture), before);
    assert.equal(fixture.registry.size, 2);
    assert.deepEqual(fixture.messages, ['Native host registered for chrome, firefox']);
});

test('uninstall without an installation record is a silent no-op', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('uninstall', []);
    assert.deepEqual(fs.readdirSync(fixture.root), []);
    assert.deepEqual(fixture.commands, []);
    assert.deepEqual(fixture.messages, []);
});

test('stable records distinguish profiles, persist offline, and withdraw only the last shared grant', async t => {
    const fixture = isolatedInstallation(t);
    const caller = nativeCaller([`chrome-extension://${chromeId}/`, '--parent-window=0']);
    const firefox = nativeCaller([fixture.file('firefox.json'), firefoxId]);
    const first = randomUUID(), second = randomUUID();
    await manageHostRegistration('add', bothBrowsers);
    const [unbound] = listConnections().connections;
    await Promise.all([rememberInstance(caller, first), rememberInstance(caller, second)]);
    await assert.rejects(rememberInstance({ ...firefox, extensionId: 'unknown@example.com' }, first), /EXTENSION_NOT_REGISTERED/);
    await assert.rejects(manageHostRegistration('add', ['--firefox-id', firefoxId, '--instance', first]), /握手/);
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--instance', first]);
    await assert.rejects(removeConnection(unbound), /已变化/);
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--instance', second]);
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--instance', second]);
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    const [one, otherBrowser, two] = listConnections().connections;
    assert.equal(one.id, unbound.id);
    assert.equal(listConnections().connections.length, 3);
    assert.equal(one.instanceId, first);
    assert.equal(two.instanceId, second);
    assert.equal(one.candidates.length, 2);
    assert.equal(otherBrowser.kind, 'firefox');
    assert.match((await clientConfig(one.id)).codex, /--connection/);
    fs.writeFileSync(instanceFile(first), JSON.stringify({ instanceId: first, pid: process.pid, caller }));
    assert.equal(listConnections().connections[0].status, 'online');
    await assert.rejects(removeConnection(one), new RegExp(first));
    await removeConnection(two);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, [`chrome-extension://${chromeId}/`]);
    fs.unlinkSync(instanceFile(first));
    const offline = listConnections().connections[0];
    assert.equal(offline.status, 'offline');
    assert.equal(offline.instanceId, first);
    await removeConnection(offline);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, []);
    assert.deepEqual(listConnections().connections.map(x => x.id), [otherBrowser.id]);
    assert.deepEqual(fixture.read('firefox.json').allowed_extensions, [firefoxId]);
    await manageHostRegistration('add', ['--chrome-id', 'b'.repeat(32)]);
    const replacement = listConnections().connections.at(-1);
    assert.notEqual(replacement.id, one.id);
    assert.equal(replacement.instanceId, null);
    assert.deepEqual(replacement.candidates, []);
});

test('list reports unmatched live instances and scopes their status to the affected connection', async t => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    const caller = nativeCaller([`chrome-extension://${chromeId}/`]);
    const instance = randomUUID();
    fs.writeFileSync(instanceFile(instance), JSON.stringify({ instanceId: instance, pid: process.pid, caller }));
    const store = fixture.read('connections.json');
    store.connections[0].note = 'obsolete';
    fs.writeFileSync(fixture.file('connections.json'), JSON.stringify(store));

    const pending = listConnections();
    assert.deepEqual(pending.unconfirmedInstances, [instance]);
    assert.deepEqual(pending.connections.map(item => item.status), ['unconfirmed', 'offline']);
    assert.ok(!Object.hasOwn(pending.connections[0], 'note'));

    await rememberInstance(caller, instance);
    const matched = listConnections();
    assert.deepEqual(matched.unconfirmedInstances, []);
    assert.deepEqual(matched.connections[0].candidates, [{ instanceId: instance, online: true }]);
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--instance', instance]);
    fs.unlinkSync(instanceFile(instance));
    const otherProfile = randomUUID();
    fs.writeFileSync(instanceFile(otherProfile), JSON.stringify({ instanceId: otherProfile, pid: process.pid, caller }));
    const offline = listConnections();
    assert.deepEqual(offline.unconfirmedInstances, [otherProfile]);
    assert.equal(offline.connections[0].status, 'offline');
    assert.deepEqual(offline.connections[0].candidates, [{ instanceId: instance, online: false }]);
});

test('uninstall rejects arguments before changing registrations, and reused numbers cannot revive client bindings', async t => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    // Existing registrations acquire their durable binding at first config, including concurrent callers.
    const store = fixture.read('connections.json');
    delete store.connections[0].bindingId;
    fs.writeFileSync(fixture.file('connections.json'), JSON.stringify(store));
    const [first, again] = await Promise.all([clientConfig('c1'), clientConfig('c1')]);
    assert.deepEqual(first, again);
    const bindingId = first.claude.mcpServers.jtcrpa.args.at(-1);
    assert.equal(bindingId, listConnections().connections[0].bindingId);
    const original = installedFiles(fixture);
    for (const args of [['--help'], ['--unknown'], ['c1']]) {
        await assert.rejects(manageHostRegistration('uninstall', args), /does not accept arguments/);
        assert.deepEqual(installedFiles(fixture), original);
        assert.equal(fixture.registry.get(chromeKey), fixture.file('chrome.json'));
    }
    await manageHostRegistration('uninstall', []);
    await manageHostRegistration('add', ['--firefox-id', firefoxId]);
    const [replacement] = listConnections().connections;
    assert.equal(replacement.id, 'c1');
    assert.notEqual(replacement.bindingId, bindingId);
    await assert.rejects(callExtension({ bindingId }, 'connection_status'), /CONNECTION_REMOVED/);
    await assert.rejects(callExtension({ bindingId: replacement.bindingId }, 'connection_status'), /CONNECTION_INSTANCE_NOT_SELECTED/);
});

test('remove restores the connection record if its last grant cannot be withdrawn', async t => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    const old = installedFiles(fixture);
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (to === fixture.file('chrome.json')) throw new Error('manifest busy');
        return rename(from, to);
    });
    await assert.rejects(removeConnection(listConnections().connections[0]), /manifest busy/);
    assert.deepEqual(installedFiles(fixture), old);
});
