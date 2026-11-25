import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { manageHostRegistration, removeConnection, clientConfig } from '../dist/install.js';
import { connect } from '../dist/connect.js';
import { clearCommand } from '../dist/connection-cli.js';
import { listConnections, rememberInstance, saveRouterSettings } from '../dist/connections.js';
import { instanceFile, sessionEndpoint } from '../dist/paths.js';
import { nativeCaller } from '../dist/browser-identity.js';
import { randomUUID } from 'node:crypto';
import { callExtension } from '../dist/ipc.js';
import { HOST } from '../dist/protocol.js';
import { readHostRegistration } from '../dist/native-host-registry.js';

const mac = process.platform === 'darwin';
const launcherName = mac ? 'host.sh' : 'host.cmd';

const chromeId = 'a'.repeat(32);
const firefoxId = 'test@example.com';
const bothBrowsers = ['--chrome-id', chromeId, '--firefox-id', firefoxId];
const chromeKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;
const firefoxKey = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST}`;
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

// 文件使用隔离目录，注册表与权限脚本均用桩替代，不触碰真实宿主注册。
function isolatedInstallation(t, { failRegistry, failDirectory } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-install-test-'));
    if (mac) t.mock.method(os, 'homedir', () => path.join(root, 'user'));
    const previousHome = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = root;
    const registry = new Map();
    const chromeProcesses = [];
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
        if (mac && command === '/usr/bin/pgrep') {
            const name = new RegExp('^(?:' + args.at(-1) + ')$');
            const pids = chromeProcesses.flatMap((line, i) => name.test(path.basename(line.split(' --')[0])) ? [i + 100] : []);
            return { status: pids.length ? 0 : 1, stdout: pids.join('\n') };
        }
        if (mac && command === '/bin/ps') {
            const pids = args[args.indexOf('-p') + 1].split(',');
            return { status: 0, stdout: pids.map(pid => chromeProcesses[Number(pid) - 100]).join('\n') };
        }
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
        root, registry, commands, messages, chromeProcesses,
        file: (name) => path.join(root, name),
        read: (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')),
    };
}

function installedFiles(fixture) {
    return [launcherName, 'installation.json', 'chrome.json', 'firefox.json', 'connections.json'].map((name) => {
        const file = fixture.file(name);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    });
}

for (const browser of ['Google Chrome', 'Microsoft Edge', 'Firefox']) {
    test('connect returns a bound configuration without starting an AI client: ' + browser, t => checkConnect(t, browser));
}

async function checkConnect(t, browser) {
    const fixture = isolatedInstallation(t);
    const firefox = browser === 'Firefox';
    const caller = firefox ? { kind: 'firefox', extensionId: firefoxId } : { kind: 'chrome', extensionId: chromeId };
    const selector = ['--' + caller.kind + '-id', caller.extensionId];
    const setup = [...selector];
    const root = path.join(os.homedir(), 'Library/Application Support', browser === 'Google Chrome' ? 'Google/Chrome' : browser);
    if (mac && !firefox) {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'Local State'), '{}');
        fixture.chromeProcesses.push('/Applications/' + browser + '.app/Contents/MacOS/' + browser);
        setup.push('--chrome-user-data-dir', root);
    }
    await manageHostRegistration('add', setup);
    const instanceId = randomUUID(), ticket = randomUUID();
    const session = randomUUID().replaceAll('-', '');
    const pipe = sessionEndpoint(session);
    const handshakes = [];
    const server = net.createServer(socket => {
        let data = '';
        socket.on('data', chunk => {
            data += chunk;
            if (!data.includes('\n')) return;
            const request = JSON.parse(data);
            handshakes.push(request);
            socket.end(JSON.stringify({ ok: true, result: { instanceId, label: '工作' } }) + '\n');
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
    try {
        fs.writeFileSync(instanceFile(instanceId), JSON.stringify({ version: 1, instanceId, session, pipe,
            token: 'a'.repeat(64), pid: process.pid, caller }));
        await rememberInstance(caller, instanceId);
        const previous = fixture.read('connections.json');
        const originalId = previous.connections[0].bindingId;
        const expectedName = 'jtcrpa_' + caller.kind + '_c1' + (firefox ? '_existing' : '');
        if (firefox) {
            previous.connections[0].codexServer = expectedName;
            fs.writeFileSync(fixture.file('connections.json'), JSON.stringify(previous));
        }
        fixture.messages.length = 0;
        t.mock.method(childProcess, 'spawn', () => assert.fail('Unexpected background process during registration'));
        syncBuiltinESMExports();
        const args = [...selector, '--instance', instanceId, '--setup', ticket];
        await connect(args);
        const [binding] = fixture.read('connections.json').connections;
        assert.equal(binding.serverName, expectedName);
        assert.equal(binding.bindingId, originalId);
        const config = { mcpServers: { [binding.serverName]: { type: 'stdio', command: process.execPath,
            args: [cli, 'mcp', '--connection', binding.bindingId, '--expect-instance', instanceId] } } };
        assert.deepEqual(fixture.messages.map(JSON.parse), [config]);
        assert.deepEqual(handshakes[1].params.config, config);
        assert.deepEqual(handshakes.map(item => [item.method, item.params.ticket]), [['codex_setup', ticket], ['codex_setup', ticket]]);
        assert.equal(handshakes[1].params.serverName, binding.serverName);
        if (mac && !firefox) assert.deepEqual(fixture.read('installation.json').chromeDataDirs, [fs.realpathSync(root)]);
        await connect(args);
        assert.deepEqual(fixture.messages.map(JSON.parse), [config, config]);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('add writes exact launcher and browser-specific manifests, then uninstall removes owned registration', async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    if (mac) {
        for (const [vendor, name] of [['Google/Chrome', 'chrome'], ['Mozilla', 'firefox']]) {
            const file = fixture.file(`user/Library/Application Support/${vendor}/NativeMessagingHosts/${HOST}.json`);
            assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), fixture.read(name + '.json'));
        }
        for (const name of [launcherName, 'instances']) assert.equal(fs.statSync(fixture.file(name)).mode & 0o777, 0o700);
    } else assert.equal(fs.readFileSync(fixture.file('host.cmd'), 'utf8'), `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host "%~1" "%~2"\r\n`);
    assert.deepEqual(fixture.read('installation.json'), { kinds: ['chrome', 'firefox'], node: process.execPath, cli,
        ...(mac ? { chromeDataDirs: [path.join(os.homedir(), 'Library/Application Support/Google/Chrome')] } : {}) });
    const common = { name: HOST, description: 'Jiutouchong MCP bridge', path: fixture.file(launcherName), type: 'stdio' };
    assert.deepEqual(fixture.read('chrome.json'), { ...common, allowed_origins: [`chrome-extension://${chromeId}/`] });
    assert.deepEqual(fixture.read('firefox.json'), { ...common, allowed_extensions: [firefoxId] });
    assert.equal(readHostRegistration('chrome'), fixture.file('chrome.json'));
    assert.equal(readHostRegistration('firefox'), fixture.file('firefox.json'));
    await manageHostRegistration('uninstall', []);
    assert.equal(readHostRegistration('chrome'), undefined);
    assert.equal(readHostRegistration('firefox'), undefined);
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
    assert.equal(readHostRegistration('firefox'), fixture.file('firefox.json'));
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

test('add refuses to overwrite another installation', { skip: process.platform !== 'win32' }, async (t) => {
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

test('permission preparation failure does not write host files or registry', { skip: process.platform !== 'win32' }, async (t) => {
    const fixture = isolatedInstallation(t, { failDirectory: true });
    await assert.rejects(manageHostRegistration('add', bothBrowsers), { message: 'Directory permissions failed' });
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
});

test('failed second registration removes the first registration and new host files', { skip: process.platform !== 'win32' }, async (t) => {
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action, key]) => action === 'add' && key === firefoxKey ? 'Registration denied' : undefined,
    });
    await assert.rejects(manageHostRegistration('add', bothBrowsers), { message: 'Host registration failed: Registration denied' });
    assert.equal(readHostRegistration('chrome'), undefined);
    assert.equal(readHostRegistration('firefox'), undefined);
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    assert.deepEqual(fixture.messages, []);
});

test('failed upgrade restores existing file bytes and registrations', { skip: process.platform !== 'win32' }, async (t) => {
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
    assert.equal(readHostRegistration('chrome'), fixture.file('chrome.json'));
    assert.equal(readHostRegistration('firefox'), fixture.file('firefox.json'));
});

test('uninstall preserves a registration taken over by another installation', { skip: process.platform !== 'win32' }, async (t) => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    fixture.registry.set(chromeKey, fixture.file('another-host.json'));
    await manageHostRegistration('uninstall', []);
    assert.deepEqual(fixture.registry, new Map([[chromeKey, fixture.file('another-host.json')]]));
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
});

test('uninstall reports registry removal failure and leaves that host recoverable', { skip: process.platform !== 'win32' }, async (t) => {
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
        assert.equal(readHostRegistration('chrome'), fixture.file('chrome.json'));
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

test('clear removes every profile and grant while retaining the native host installation', async t => {
    const fixture = isolatedInstallation(t);
    const chromium = { kind: 'chrome', extensionId: chromeId };
    const firefox = { kind: 'firefox', extensionId: firefoxId };
    await manageHostRegistration('add', bothBrowsers);
    for (const [caller, brand] of [[chromium, 'chrome'], [chromium, 'edge'], [firefox, 'firefox']]) {
        const instance = randomUUID();
        await rememberInstance(caller, instance);
        await manageHostRegistration('add', ['--' + caller.kind + '-id', caller.extensionId, '--instance', instance]);
        await saveRouterSettings(caller, instance, { grantId: randomUUID(), label: '', brand });
    }
    const before = fixture.read('connections.json');
    const [launcher, installation] = installedFiles(fixture);
    const registrations = [readHostRegistration('chrome'), readHostRegistration('firefox')];
    const original = installedFiles(fixture);
    await clearCommand(['--help']);
    assert.match(fixture.messages.at(-1), /Usage: jtcrpa-mcp clear/);
    await assert.rejects(clearCommand(['c1']));
    assert.deepEqual(installedFiles(fixture), original);

    await clearCommand([]);
    assert.equal(fixture.messages.at(-1), '已清空 3 条连接。');
    assert.deepEqual(fixture.read('connections.json'), { nextId: before.nextId, connections: [], observed: [] });
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, []);
    assert.deepEqual(fixture.read('firefox.json').allowed_extensions, []);
    assert.deepEqual(installedFiles(fixture).slice(0, 2), [launcher, installation]);
    assert.deepEqual([readHostRegistration('chrome'), readHostRegistration('firefox')], registrations);
    const cleared = installedFiles(fixture);
    await clearCommand([]);
    assert.deepEqual(installedFiles(fixture), cleared);
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    assert.equal(listConnections().connections[0].id, 'c' + before.nextId);
    for (const { bindingId } of before.connections) {
        await assert.rejects(callExtension({ bindingId }, 'connection_status'), /CONNECTION_REMOVED/);
    }
});

test('clear preserves all registrations if a host is active or saving the cleared store fails', async t => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', bothBrowsers);
    const old = installedFiles(fixture);
    const instanceId = randomUUID();
    fs.writeFileSync(instanceFile(instanceId), JSON.stringify({ instanceId, pid: process.pid }));
    await assert.rejects(clearCommand([]), /关闭所有浏览器配置中的 MCP/);
    assert.deepEqual(installedFiles(fixture), old);
    fs.unlinkSync(instanceFile(instanceId));

    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (to === fixture.file('connections.json')) throw new Error('connections file busy');
        return rename(from, to);
    });
    await assert.rejects(clearCommand([]), /connections file busy/);
    assert.deepEqual(installedFiles(fixture), old);
});

test('macOS registration rolls back a partial install and preserves foreign manifests', { skip: !mac }, async t => {
    const fixture = isolatedInstallation(t);
    const support = fixture.file('user/Library/Application Support');
    const chrome = path.join(support, 'Google/Chrome/NativeMessagingHosts', HOST + '.json');
    const firefox = path.join(support, 'Mozilla/NativeMessagingHosts', HOST + '.json');
    const symlink = fs.symlinkSync;
    const failure = t.mock.method(fs, 'symlinkSync', (source, target) => {
        if (target === firefox) throw new Error('Registration denied');
        return symlink(source, target);
    });
    await assert.rejects(manageHostRegistration('add', bothBrowsers), /Registration denied/);
    assert.equal(fs.lstatSync(chrome, { throwIfNoEntry: false }), undefined);
    assert.ok(installedFiles(fixture).every(contents => contents === undefined));
    failure.mock.restore();

    fs.writeFileSync(firefox, 'another host');
    await assert.rejects(manageHostRegistration('add', bothBrowsers), /different firefox host/);
    assert.equal(fs.readFileSync(firefox, 'utf8'), 'another host');
    fs.unlinkSync(firefox);
    await manageHostRegistration('add', bothBrowsers);
    fs.unlinkSync(chrome);
    fs.symlinkSync(fixture.file('missing-foreign.json'), chrome);
    await manageHostRegistration('uninstall', []);
    assert.equal(fs.readlinkSync(chrome), fixture.file('missing-foreign.json'));
    assert.equal(fs.lstatSync(firefox, { throwIfNoEntry: false }), undefined);
});

test('macOS registers the running Chrome root containing the extension and remembers it offline', { skip: !mac }, async t => {
    const fixture = isolatedInstallation(t);
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const hostFile = root => path.join(root, 'NativeMessagingHosts', HOST + '.json');
    const dev = fixture.file('profile with spaces');
    const other = fixture.file('other profile');
    const prefs = path.join('Profile 2', 'Secure Preferences');
    for (const [root, id] of [[other, 'b'.repeat(32)], [dev, chromeId]]) {
        fs.mkdirSync(path.join(root, 'Profile 2'), { recursive: true });
        fs.writeFileSync(path.join(root, 'Local State'), '{}');
        fs.writeFileSync(path.join(root, prefs), JSON.stringify({ extensions: { settings: { [id]: {} } } }));
        fixture.chromeProcesses.push(executable + ' --user-data-dir=' + root + ' --no-first-run');
    }
    const expected = fixture.file('chrome.json');
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    assert.equal(fs.readlinkSync(hostFile(dev)), expected);
    assert.equal(fs.existsSync(hostFile(other)), false);
    assert.equal(fs.existsSync(hostFile(path.join(os.homedir(), 'Library/Application Support/Google/Chrome'))), false);
    fs.copyFileSync(path.join(dev, prefs), path.join(other, prefs));
    await assert.rejects(manageHostRegistration('add', ['--chrome-id', chromeId]), /--chrome-user-data-dir/);
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--chrome-user-data-dir', other]);
    assert.equal(fs.readlinkSync(hostFile(other)), expected);
    fixture.chromeProcesses.length = 0;
    await removeConnection(listConnections().connections[0]);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, []);
    await manageHostRegistration('uninstall', []);
    for (const root of [dev, other]) assert.equal(fs.lstatSync(hostFile(root), { throwIfNoEntry: false }), undefined);
});

test('macOS resolves a custom Edge root alongside Chrome and requests a directory for an ambiguous live setup', { skip: !mac }, async t => {
    const fixture = isolatedInstallation(t);
    const google = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
    const edge = fixture.file('custom Edge root');
    fs.mkdirSync(google, { recursive: true });
    fs.mkdirSync(path.join(edge, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(edge, 'Local State'), '{}');
    fixture.chromeProcesses.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge --user-data-dir=' + edge);
    await assert.rejects(connect(['--chrome-id', chromeId, '--instance', randomUUID(), '--setup', randomUUID()]),
        /--chrome-user-data-dir/);
    fs.writeFileSync(path.join(edge, 'Default', 'Preferences'), JSON.stringify({ extensions: { settings: { [chromeId]: {} } } }));
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    assert.equal(fs.readlinkSync(path.join(edge, 'NativeMessagingHosts', HOST + '.json')), fixture.file('chrome.json'));
    assert.equal(fs.existsSync(path.join(google, 'NativeMessagingHosts')), false);
});

test('macOS retains a legacy default registration when adding a temporary Chrome root', { skip: !mac }, async t => {
    const fixture = isolatedInstallation(t);
    await manageHostRegistration('add', ['--chrome-id', chromeId]);
    const legacy = fixture.read('installation.json');
    delete legacy.chromeDataDirs;
    fs.writeFileSync(fixture.file('installation.json'), JSON.stringify(legacy));
    const dev = fixture.file('development');
    fs.mkdirSync(dev);
    fs.writeFileSync(path.join(dev, 'Local State'), '{}');
    await manageHostRegistration('add', ['--chrome-id', chromeId, '--chrome-user-data-dir', dev]);
    const defaultDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
    assert.deepEqual(fixture.read('installation.json').chromeDataDirs, [defaultDir, fs.realpathSync(dev)]);

    // The dev launcher removes its user data root; uninstall still owns the default link.
    fs.rmSync(dev, { recursive: true });
    await manageHostRegistration('uninstall', []);
    assert.equal(fs.lstatSync(path.join(defaultDir, 'NativeMessagingHosts', HOST + '.json'), { throwIfNoEntry: false }), undefined);
    assert.equal(fs.existsSync(dev), false);
});
