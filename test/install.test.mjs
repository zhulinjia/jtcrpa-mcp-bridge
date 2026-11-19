import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { install } from '../src/install.ts';
import { HOST } from '../src/protocol.ts';

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
    return ['host.cmd', 'installation.json', 'chrome.json', 'firefox.json'].map((name) => {
        const file = fixture.file(name);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    });
}

test('install writes exact launcher and browser-specific manifests, then uninstall removes owned registration', async (t) => {
    const fixture = isolatedInstallation(t);
    await install('install', bothBrowsers);
    assert.equal(fs.readFileSync(fixture.file('host.cmd'), 'utf8'), `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host\r\n`);
    assert.deepEqual(fixture.read('installation.json'), { kinds: ['chrome', 'firefox'], node: process.execPath, cli });
    const common = { name: HOST, description: 'Jiutouchong MCP bridge', path: fixture.file('host.cmd'), type: 'stdio' };
    assert.deepEqual(fixture.read('chrome.json'), { ...common, allowed_origins: [`chrome-extension://${chromeId}/`] });
    assert.deepEqual(fixture.read('firefox.json'), { ...common, allowed_extensions: [firefoxId] });
    assert.equal(fixture.registry.get(chromeKey), fixture.file('chrome.json'));
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
    await install('uninstall', []);
    assert.equal(fixture.registry.size, 0);
    assert.deepEqual(installedFiles(fixture), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(fixture.messages, ['Native host registered for chrome, firefox', 'Native host unregistered.']);
});

test('separate browser installs and updates preserve the other browser and recorded order', async (t) => {
    const fixture = isolatedInstallation(t);
    await install('install', ['--firefox-id', firefoxId]);
    const firefoxManifest = fs.readFileSync(fixture.file('firefox.json'), 'utf8');
    await install('install', ['--chrome-id', chromeId]);
    await install('install', ['--chrome-id', 'b'.repeat(32)]);
    assert.deepEqual(fixture.read('installation.json').kinds, ['firefox', 'chrome']);
    assert.equal(fs.readFileSync(fixture.file('firefox.json'), 'utf8'), firefoxManifest);
    assert.deepEqual(fixture.read('chrome.json').allowed_origins, [`chrome-extension://${'b'.repeat(32)}/`]);
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
});

test('invalid extension arguments fail before files or registration are changed', async (t) => {
    const fixture = isolatedInstallation(t);
    const cases = [
        [[], 'Provide --chrome-id or --firefox-id with the installed extension ID.'],
        [['--chrome-id'], 'Provide --chrome-id or --firefox-id with the installed extension ID.'],
        [['--chrome-id', 'invalid'], 'Invalid Chrome extension ID'],
        [['--firefox-id', 'invalid/id'], 'Invalid Firefox extension ID'],
    ];
    for (const [args, message] of cases) {
        await assert.rejects(install('install', args), { message });
    }
    assert.deepEqual(fs.readdirSync(fixture.root), []);
    assert.deepEqual(fixture.commands, []);
});

test('install refuses to overwrite another installation', async (t) => {
    const fixture = isolatedInstallation(t);
    fixture.registry.set(chromeKey, fixture.file('another-host.json'));
    await assert.rejects(install('install', bothBrowsers), /A different chrome host is registered/);
    assert.equal(fixture.registry.get(chromeKey), fixture.file('another-host.json'));
    assert.deepEqual(installedFiles(fixture), [undefined, undefined, undefined, undefined]);
    assert.ok(fixture.commands.every(([action]) => action === 'query'));
});

test('active instance prevents install and uninstall', async (t) => {
    const fixture = isolatedInstallation(t);
    fs.mkdirSync(fixture.file('instances'));
    fs.writeFileSync(fixture.file(`instances/${'a'.repeat(64)}.json`), JSON.stringify({ pid: process.pid, instanceId: 'online' }));
    await assert.rejects(install('install', bothBrowsers), { message: 'Disable MCP before changing host registration.' });
    await assert.rejects(install('uninstall', []), { message: 'Disable MCP in the browser before uninstalling.' });
    assert.deepEqual(fixture.commands, []);
});

test('permission preparation failure does not write host files or registry', async (t) => {
    const fixture = isolatedInstallation(t, { failDirectory: true });
    await assert.rejects(install('install', bothBrowsers), { message: 'Directory permissions failed' });
    assert.deepEqual(installedFiles(fixture), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(fixture.commands, []);
});

test('failed second registration removes the first registration and new host files', async (t) => {
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action, key]) => action === 'add' && key === firefoxKey ? 'Registration denied' : undefined,
    });
    await assert.rejects(install('install', bothBrowsers), { message: 'Host registration failed: Registration denied' });
    assert.equal(fixture.registry.size, 0);
    assert.deepEqual(installedFiles(fixture), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(fixture.messages, []);
});

test('failed upgrade restores existing file bytes and registrations', async (t) => {
    let failUpdate = false;
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action, key]) => failUpdate && action === 'add' && key === firefoxKey ? 'Update denied' : undefined,
    });
    await install('install', bothBrowsers);
    const before = installedFiles(fixture);
    const registrations = new Map(fixture.registry);
    failUpdate = true;
    await assert.rejects(install('install', ['--chrome-id', 'c'.repeat(32), '--firefox-id', 'new@example.com']), /Update denied/);
    assert.deepEqual(installedFiles(fixture), before);
    assert.deepEqual(fixture.registry, registrations);
});

test('file write failure restores prior files before reporting the error', async (t) => {
    const fixture = isolatedInstallation(t);
    await install('install', bothBrowsers);
    const before = installedFiles(fixture);
    const originalWrite = fs.writeFileSync;
    let failed = false;
    t.mock.method(fs, 'writeFileSync', (file, ...args) => {
        if (file === fixture.file('chrome.json') && !failed) {
            failed = true;
            throw new Error('Manifest write failed');
        }
        return originalWrite(file, ...args);
    });
    await assert.rejects(install('install', bothBrowsers), { message: 'Manifest write failed' });
    assert.equal(failed, true);
    assert.deepEqual(installedFiles(fixture), before);
    assert.equal(fixture.registry.get(chromeKey), fixture.file('chrome.json'));
    assert.equal(fixture.registry.get(firefoxKey), fixture.file('firefox.json'));
});

test('uninstall preserves a registration taken over by another installation', async (t) => {
    const fixture = isolatedInstallation(t);
    await install('install', bothBrowsers);
    fixture.registry.set(chromeKey, fixture.file('another-host.json'));
    await install('uninstall', []);
    assert.deepEqual(fixture.registry, new Map([[chromeKey, fixture.file('another-host.json')]]));
    assert.deepEqual(installedFiles(fixture), [undefined, undefined, undefined, undefined]);
});

test('uninstall reports registry removal failure and leaves that host recoverable', async (t) => {
    const fixture = isolatedInstallation(t, {
        failRegistry: ([action]) => action === 'delete' ? 'Removal denied' : undefined,
    });
    await install('install', bothBrowsers);
    const before = installedFiles(fixture);
    await assert.rejects(install('uninstall', []), { message: 'Removal denied' });
    assert.deepEqual(installedFiles(fixture), before);
    assert.equal(fixture.registry.size, 2);
    assert.deepEqual(fixture.messages, ['Native host registered for chrome, firefox']);
});

test('uninstall without an installation record is a silent no-op', async (t) => {
    const fixture = isolatedInstallation(t);
    await install('uninstall', []);
    assert.deepEqual(fs.readdirSync(fixture.root), []);
    assert.deepEqual(fixture.commands, []);
    assert.deepEqual(fixture.messages, []);
});
