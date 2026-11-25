import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { bridgeRoot, listRunningHosts } from './paths.ts';
import { HOST, validInstance } from './protocol.ts';
import { defaultChromeDataDir, resolveChromeDataDir } from './mac-chrome.ts';
import { withRegistrationLock } from './registration-lock.ts';
import { replaceFile } from './registration-files.ts';
import { browserBrand, checkExtensionId, sameExtension, type BrowserTarget } from './browser-identity.ts';
import { addConnection, bindingForConnection, connectionFile, ensureCanRemove, getConnection, readConnections, validConnectionId, type Connection } from './connections.ts';
import {
    readHostRegistration,
    registerHost,
    restoreHostRegistration,
    unregisterHost,
    type BrowserKind,
} from './native-host-registry.ts';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

interface InstallationPaths {
    root: string;
    record: string;
    launcher: string;
}

interface InstallationRecord {
    kinds: BrowserKind[];
    node?: string;
    cli?: string;
    chromeDataDirs?: string[];
}

interface InstallationBackup {
    files: Map<string, Buffer | undefined>;
    chromeDataDir?: string;
    registrations: Map<BrowserKind, string | undefined>;
}

export function boundClientConfig(name: string, bindingId: string, instanceId: string) {
    const args = [cli, 'mcp', '--connection', bindingId, '--expect-instance', instanceId];
    return { mcpServers: { [name]: { type: 'stdio', command: process.execPath, args } } };
}

export function routerClientConfig() {
    return { mcpServers: { jtcrpa: { type: 'stdio', command: process.execPath, args: [cli, 'mcp', '--router'] } } };
}

export async function clientConfig(target: string) {
    const byConnection = validConnectionId(target);
    if (!byConnection && !validInstance(target)) throw new Error('INVALID_INSTANCE_ID');
    const args = [cli, 'mcp', ...(byConnection ? ['--connection', await bindingForConnection(target)] : ['--instance', target])];
    return {
        codex: `[mcp_servers.jtcrpa]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(args)}\n`,
        claude: { mcpServers: { jtcrpa: { command: process.execPath, args } } },
        deepseek: [{ id: 'mcp-jtcrpa', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'jtcrpa', transport: 'stdio', command: process.execPath, args } }],
    };
}

function installationPaths(): InstallationPaths {
    const root = bridgeRoot();
    const launcher = process.platform === 'darwin' ? 'host.sh' : 'host.cmd';
    return { root, record: path.join(root, 'installation.json'), launcher: path.join(root, launcher) };
}

export async function manageHostRegistration(command: 'add' | 'uninstall', args: string[], { fromRunningBrowser = false } = {}): Promise<void> {
    if (command === 'uninstall' && args.length) throw new Error('uninstall does not accept arguments. See jtcrpa-mcp uninstall --help.');
    const paths = installationPaths();
    await withRegistrationLock(() => {
        if (command === 'uninstall') uninstallNativeHost(paths);
        else {
            const { targets, instanceId, chromeDataDir } = parseBrowserTargets(args, fromRunningBrowser);
            const message = addNativeHost(paths, targets, instanceId, chromeDataDir);
            if (fromRunningBrowser) console.error(message);
            else console.log(message);
        }
    });
}

function addNativeHost(paths: InstallationPaths, targets: BrowserTarget[], instanceId?: string, chromeDataDir?: string): string {
    if (process.platform === 'win32' && /["%\r\n]/.test(cli + process.execPath + paths.root)) throw new Error('Unsupported character in installation path');
    const backup = captureInstallationBackup(paths, targets, chromeDataDir);
    const previous = fs.existsSync(paths.record) ? readInstallationRecord(paths.record) : { kinds: [] };
    const files = sharedInstallationFiles(paths, previous, targets, chromeDataDir);
    const store = readConnections();
    const register = new Map<BrowserKind, string>();
    for (const target of targets) {
        addConnection(store, target, instanceId);
        const manifest = manifestPath(paths, target.kind);
        files.set(manifest, JSON.stringify(createHostManifest(paths.launcher, target, backup.files.get(manifest), 'add'), null, 2));
        if (!backup.registrations.get(target.kind)) register.set(target.kind, manifest);
    }
    files.set(connectionFile(), JSON.stringify(store));
    const browsers = targets.map(target => target.kind).join(', ');
    const changed = commitRegistration(paths, backup, files, register);
    return (changed ? 'Native host registered for ' : 'Native host already registered for ') + browsers;
}

export async function removeConnection(expected: Connection): Promise<void> {
    await withRegistrationLock(() => {
        const store = readConnections();
        const before = getConnection(store, expected.id);
        if (!sameExtension(before, expected) || before.instanceId !== expected.instanceId || before.bindingId !== expected.bindingId) {
            throw new Error('所选连接已变化，请重新查看列表。');
        }
        store.connections = store.connections.filter(item => item.id !== before.id);
        const revoke = !store.connections.some(item => sameExtension(before, item));
        ensureCanRemove(before, revoke);
        if (revoke) store.observed = store.observed.filter(item => !sameExtension(before, item));
        const paths = installationPaths();
        const backup = captureInstallationBackup(paths, []);
        const files = new Map([[connectionFile(), JSON.stringify(store)]]);
        if (revoke) {
            const manifest = manifestPath(paths, before.kind);
            const installation = readInstallationRecord(paths.record);
            const locations = registeredDataDirs(installation, before.kind);
            // Temporary development roots may have disappeared since registration.
            const remaining = locations.filter(dir => dir === undefined || fs.existsSync(dir));
            if (remaining.length && !remaining.some(dir => readHostRegistration(before.kind, dir) === manifest)) {
                throw new Error('本机宿主登记缺失，请重新运行 add。');
            }
            backup.files.set(manifest, fs.readFileSync(manifest));
            files.set(manifest, JSON.stringify(createHostManifest(paths.launcher, before, backup.files.get(manifest), 'remove'), null, 2));
        }
        commitRegistration(paths, backup, files, new Map());
    });
}

function commitRegistration(paths: InstallationPaths, backup: InstallationBackup, files: Map<string, string>, register: Map<BrowserKind, string>): boolean {
    for (const [file, contents] of files) {
        if (backup.files.get(file)?.toString('utf8') !== contents) continue;
        if (process.platform === 'darwin' && file === paths.launcher && (fs.statSync(file).mode & 0o777) !== 0o700) continue;
        files.delete(file);
    }
    if (files.size === 0 && register.size === 0) return false;
    if (files.has(paths.launcher) && listRunningHosts().length) {
        throw new Error('Disable MCP before changing the native host launcher.');
    }
    if (files.has(paths.launcher) || register.size) prepareInstallationDirectory(paths.root);
    const updatedFiles: string[] = [];
    const updatedRegistry: BrowserKind[] = [];
    try {
        for (const [file, contents] of files) {
            replaceFile(file, contents, file === paths.launcher ? 0o700 : 0o600);
            updatedFiles.push(file);
        }
        for (const [kind, manifest] of register) {
            registerHost(kind, manifest, backup.chromeDataDir);
            updatedRegistry.push(kind);
        }
    } catch (error) {
        for (const kind of updatedRegistry) restoreHostRegistration(kind, backup.registrations.get(kind), manifestPath(paths, kind), backup.chromeDataDir);
        for (const file of updatedFiles) {
            const contents = backup.files.get(file);
            if (contents) replaceFile(file, contents, file === paths.launcher ? 0o700 : 0o600);
            else removeFileIfPresent(file);
        }
        throw error;
    }
    return true;
}

function uninstallNativeHost(paths: InstallationPaths): void {
    if (listRunningHosts().length) throw new Error('Disable MCP in the browser before uninstalling.');
    if (!fs.existsSync(paths.record)) return;

    const installation = readInstallationRecord(paths.record);
    for (const kind of installation.kinds) {
        const manifest = manifestPath(paths, kind);
        for (const directory of registeredDataDirs(installation, kind)) {
            if (readHostRegistration(kind, directory) === manifest) unregisterHost(kind, directory);
        }
        removeFileIfPresent(manifest);
    }
    fs.unlinkSync(paths.record);
    removeFileIfPresent(connectionFile());
    removeFileIfPresent(paths.launcher);
    console.log('Native host unregistered.');
}

function parseBrowserTargets(args: string[], fromRunningBrowser: boolean) {
    const { values } = parseArgs({ args, options: {
        'chrome-user-data-dir': { type: 'string' }, 'chrome-id': { type: 'string' }, 'firefox-id': { type: 'string' }, instance: { type: 'string' },
        brand: { type: 'string' },
    } });
    const chrome = values['chrome-id'];
    const firefox = values['firefox-id'];
    if (!chrome && !firefox) throw new Error('Provide --chrome-id or --firefox-id with the installed extension ID.');
    if (chrome) checkExtensionId('chrome', chrome);
    if (firefox) checkExtensionId('firefox', firefox);

    const targets: BrowserTarget[] = [];
    if (chrome) targets.push({ kind: 'chrome', extensionId: chrome });
    if (firefox) targets.push({ kind: 'firefox', extensionId: firefox });
    if (values.instance !== undefined && (!validInstance(values.instance) || targets.length !== 1)) throw new Error('Specify one browser and a valid instance UUID.');
    const explicit = values['chrome-user-data-dir'];
    if (explicit !== undefined && (!chrome || process.platform !== 'darwin')) {
        throw new Error('--chrome-user-data-dir 仅适用于 macOS 上的 --chrome-id。');
    }
    const brand = values.brand;
    if (brand !== undefined && (!browserBrand(brand) || !(brand === 'firefox' ? firefox : chrome))) {
        throw new Error('浏览器品牌与扩展 ID 不匹配。');
    }
    const chromeDataDir = chrome && process.platform === 'darwin' ? resolveChromeDataDir(chrome, explicit, fromRunningBrowser, brand) : undefined;
    return { targets, instanceId: values.instance, chromeDataDir };
}

function prepareInstallationDirectory(root: string): void {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (process.platform === 'darwin') {
        fs.chmodSync(root, 0o700);
        const instances = path.join(root, 'instances');
        fs.mkdirSync(instances, { recursive: true, mode: 0o700 });
        fs.chmodSync(instances, 0o700);
        return;
    }
    execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', fileURLToPath(new URL('../windows/secure-directory.ps1', import.meta.url)),
        '-Directory', root,
    ], { windowsHide: true });
    fs.mkdirSync(path.join(root, 'instances'), { recursive: true });
}

function readInstallationRecord(file: string): InstallationRecord {
    // 仅声明既有磁盘格式；结构重构不新增历史记录的运行时校验策略。
    return JSON.parse(fs.readFileSync(file, 'utf8')) as InstallationRecord;
}

function manifestPath(paths: InstallationPaths, kind: BrowserKind): string {
    return path.join(paths.root, `${kind}.json`);
}

function captureInstallationBackup(paths: InstallationPaths, targets: BrowserTarget[], chromeDataDir?: string): InstallationBackup {
    const manifestFiles = targets.map((target) => manifestPath(paths, target.kind));
    const files = new Map<string, Buffer | undefined>();
    for (const file of [paths.launcher, paths.record, connectionFile(), ...manifestFiles]) {
        files.set(file, fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    }

    const registrations = new Map<BrowserKind, string | undefined>();
    for (const { kind } of targets) {
        const manifest = readHostRegistration(kind, chromeDataDir);
        if (manifest && manifest !== manifestPath(paths, kind)) {
            throw new Error(`A different ${kind} host is registered; refusing to overwrite it.`);
        }
        registrations.set(kind, manifest);
    }
    return { files, registrations, chromeDataDir };
}

function registeredDataDirs(installation: InstallationRecord, kind: BrowserKind): (string | undefined)[] {
    if (process.platform === 'darwin' && kind === 'chrome') {
        return installation.chromeDataDirs ?? [defaultChromeDataDir()];
    }
    return [undefined];
}

function sharedInstallationFiles(paths: InstallationPaths, previous: InstallationRecord, targets: BrowserTarget[], chromeDataDir?: string): Map<string, string> {
    // 批处理文件按 UTF-8 写入，先切换代码页再读取含中文的 Node / CLI 路径。
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const launcher = process.platform === 'darwin'
        ? `#!/bin/sh\nexport JTCRPA_BRIDGE_HOME=${quote(paths.root)}\nexec ${quote(process.execPath)} ${quote(cli)} native-host "$@"\n`
        : `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host "%~1" "%~2"\r\n`;
    const requestedKinds = targets.map((target) => target.kind);
    const record: InstallationRecord = {
        kinds: [...new Set([...previous.kinds, ...requestedKinds])],
        node: process.execPath,
        cli,
    };
    if (process.platform === 'darwin' && record.kinds.includes('chrome')) {
        const dirs = previous.chromeDataDirs ?? (previous.kinds.includes('chrome') ? [defaultChromeDataDir()] : []);
        record.chromeDataDirs = [...new Set(chromeDataDir ? [...dirs, chromeDataDir] : dirs)];
    }
    return new Map([[paths.launcher, launcher], [paths.record, JSON.stringify(record)]]);
}

function createHostManifest(launcher: string, target: BrowserTarget, previous: Buffer | undefined, action: 'add' | 'remove') {
    const { kind, extensionId } = target;
    const chrome = kind === 'chrome';
    const field = chrome ? 'allowed_origins' : 'allowed_extensions';
    const entry = chrome ? `chrome-extension://${extensionId}/` : extensionId;
    let allowed: string[] = [];
    if (previous) {
        const manifest = JSON.parse(previous.toString('utf8')) as Partial<Record<'name' | 'allowed_origins' | 'allowed_extensions', unknown>> | null;
        const entries = manifest?.[field];
        const valid = chrome ? /^chrome-extension:\/\/[a-p]{32}\/$/ : /^[a-zA-Z0-9@._{}-]{1,128}$/;
        if (manifest?.name !== HOST || !Array.isArray(entries) || !entries.every(item => typeof item === 'string' && valid.test(item))) {
            throw new Error(`Invalid existing ${kind} native host manifest.`);
        }
        allowed = entries;
    }
    return {
        name: HOST,
        description: 'Jiutouchong MCP bridge',
        path: launcher,
        type: 'stdio',
        [field]: action === 'add' ? [...new Set([...allowed, entry])] : allowed.filter(item => item !== entry),
    };
}

function removeFileIfPresent(file: string): void {
    if (fs.existsSync(file)) fs.unlinkSync(file);
}
