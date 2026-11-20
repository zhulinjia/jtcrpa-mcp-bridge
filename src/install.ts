import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { bridgeRoot, listRunningHosts } from './paths.ts';
import { HOST, validInstance } from './protocol.ts';
import { withRegistrationLock } from './registration-lock.ts';
import { replaceFile } from './registration-files.ts';
import { checkExtensionId, sameExtension, type BrowserTarget } from './browser-identity.ts';
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
}

interface InstallationBackup {
    files: Map<string, Buffer | undefined>;
    registrations: Map<BrowserKind, string | undefined>;
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
    return { root, record: path.join(root, 'installation.json'), launcher: path.join(root, 'host.cmd') };
}

export async function manageHostRegistration(command: 'add' | 'uninstall', args: string[]): Promise<void> {
    if (command === 'uninstall' && args.length) throw new Error('uninstall does not accept arguments. See jtcrpa-mcp uninstall --help.');
    const paths = installationPaths();
    await withRegistrationLock(() => {
        if (command === 'uninstall') uninstallNativeHost(paths);
        else {
            const { targets, instanceId } = parseBrowserTargets(args);
            addNativeHost(paths, targets, instanceId);
        }
    });
}

function addNativeHost(paths: InstallationPaths, targets: BrowserTarget[], instanceId?: string): void {
    if (/["%\r\n]/.test(cli + process.execPath + paths.root)) throw new Error('Unsupported character in installation path');
    const backup = captureInstallationBackup(paths, targets);
    const previous = fs.existsSync(paths.record) ? readInstallationRecord(paths.record) : { kinds: [] };
    const files = sharedInstallationFiles(paths, previous, targets);
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
    console.log((changed ? 'Native host registered for ' : 'Native host already registered for ') + browsers);
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
        const backup = captureInstallationBackup(paths, revoke ? [before] : []);
        const files = new Map([[connectionFile(), JSON.stringify(store)]]);
        if (revoke) {
            const manifest = manifestPath(paths, before.kind);
            if (!backup.registrations.get(before.kind)) throw new Error('本机宿主登记缺失，请重新运行 add。');
            files.set(manifest, JSON.stringify(createHostManifest(paths.launcher, before, backup.files.get(manifest), 'remove'), null, 2));
        }
        commitRegistration(paths, backup, files, new Map());
    });
}

function commitRegistration(paths: InstallationPaths, backup: InstallationBackup, files: Map<string, string>, register: Map<BrowserKind, string>): boolean {
    for (const [file, contents] of files) {
        if (backup.files.get(file)?.toString('utf8') === contents) files.delete(file);
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
            replaceFile(file, contents);
            updatedFiles.push(file);
        }
        for (const [kind, manifest] of register) {
            updatedRegistry.push(kind);
            registerHost(kind, manifest);
        }
    } catch (error) {
        for (const kind of updatedRegistry) restoreHostRegistration(kind, backup.registrations.get(kind), manifestPath(paths, kind));
        for (const file of updatedFiles) {
            const contents = backup.files.get(file);
            if (contents) replaceFile(file, contents);
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
        if (readHostRegistration(kind) === manifest) unregisterHost(kind);
        removeFileIfPresent(manifest);
    }
    fs.unlinkSync(paths.record);
    removeFileIfPresent(connectionFile());
    removeFileIfPresent(paths.launcher);
    console.log('Native host unregistered.');
}

function parseBrowserTargets(args: string[]) {
    const { values } = parseArgs({ args, options: {
        'chrome-id': { type: 'string' }, 'firefox-id': { type: 'string' }, instance: { type: 'string' },
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
    return { targets, instanceId: values.instance };
}

function prepareInstallationDirectory(root: string): void {
    fs.mkdirSync(root, { recursive: true });
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

function captureInstallationBackup(paths: InstallationPaths, targets: BrowserTarget[]): InstallationBackup {
    const manifestFiles = targets.map((target) => manifestPath(paths, target.kind));
    const files = new Map<string, Buffer | undefined>();
    for (const file of [paths.launcher, paths.record, connectionFile(), ...manifestFiles]) {
        files.set(file, fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    }

    const registrations = new Map<BrowserKind, string | undefined>();
    for (const { kind } of targets) {
        const manifest = readHostRegistration(kind);
        if (manifest && manifest !== manifestPath(paths, kind)) {
            throw new Error(`A different ${kind} host is registered; refusing to overwrite it.`);
        }
        registrations.set(kind, manifest);
    }
    return { files, registrations };
}

function sharedInstallationFiles(paths: InstallationPaths, previous: InstallationRecord, targets: BrowserTarget[]): Map<string, string> {
    // 批处理文件按 UTF-8 写入，先切换代码页再读取含中文的 Node / CLI 路径。
    const launcher = `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host "%~1" "%~2"\r\n`;
    const requestedKinds = targets.map((target) => target.kind);
    const record: InstallationRecord = {
        kinds: [...new Set([...previous.kinds, ...requestedKinds])],
        node: process.execPath,
        cli,
    };
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
