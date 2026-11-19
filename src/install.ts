import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bridgeRoot, type Discovery } from './paths.ts';
import { HOST, validInstance } from './protocol.ts';
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

interface BrowserTarget {
    kind: BrowserKind;
    extensionId: string;
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

export function clientConfig(instanceId: string) {
    if (!validInstance(instanceId)) throw new Error('INVALID_INSTANCE_ID');
    const args = [cli, 'mcp', '--instance', instanceId];
    return {
        codex: `[mcp_servers.jtcrpa]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(args)}\n`,
        claude: { mcpServers: { jtcrpa: { command: process.execPath, args } } },
        deepseek: [{ id: 'mcp-jtcrpa', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'jtcrpa', transport: 'stdio', command: process.execPath, args } }],
    };
}
export function listInstances() {
    const directory = path.join(bridgeRoot(), 'instances');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).flatMap((name) => {
        try {
            const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Discovery;
            let online = true;
            try { process.kill(record.pid, 0); } catch { online = false; }
            return [{ instanceId: record.instanceId, online }];
        } catch { return []; }
    });
}

export async function install(command: 'install' | 'uninstall', args: string[]): Promise<void> {
    const root = bridgeRoot();
    const paths: InstallationPaths = {
        root,
        record: path.join(root, 'installation.json'),
        launcher: path.join(root, 'host.cmd'),
    };
    if (command === 'uninstall') {
        uninstallNativeHost(paths);
        return;
    }
    installNativeHost(paths, args);
}

function installNativeHost(paths: InstallationPaths, args: string[]): void {
    const targets = parseBrowserTargets(args);
    if (/["%\r\n]/.test(cli + process.execPath + paths.root)) throw new Error('Unsupported character in installation path');
    if (listInstances().some((record) => record.online)) throw new Error('Disable MCP before changing host registration.');

    prepareInstallationDirectory(paths.root);
    const previous = fs.existsSync(paths.record) ? readInstallationRecord(paths.record) : { kinds: [] };
    assertRegistrationsAvailable(paths, targets);
    const backup = captureInstallationBackup(paths, targets);

    try {
        writeSharedInstallationFiles(paths, previous, targets);
        for (const target of targets) {
            const manifest = manifestPath(paths, target.kind);
            fs.writeFileSync(manifest, JSON.stringify(createHostManifest(paths.launcher, target), null, 2));
            registerHost(target.kind, manifest);
        }
    } catch (error) {
        restoreInstallationBackup(paths, backup);
        throw error;
    }

    console.log('Native host registered for ' + targets.map((target) => target.kind).join(', '));
}

function uninstallNativeHost(paths: InstallationPaths): void {
    if (listInstances().some((record) => record.online)) throw new Error('Disable MCP in the browser before uninstalling.');
    if (!fs.existsSync(paths.record)) return;

    const installation = readInstallationRecord(paths.record);
    for (const kind of installation.kinds) {
        const manifest = manifestPath(paths, kind);
        if (readHostRegistration(kind) === manifest) unregisterHost(kind);
        removeFileIfPresent(manifest);
    }
    fs.unlinkSync(paths.record);
    removeFileIfPresent(paths.launcher);
    console.log('Native host unregistered.');
}

function parseBrowserTargets(args: string[]): BrowserTarget[] {
    const chrome = args.includes('--chrome-id') ? args[args.indexOf('--chrome-id') + 1] : undefined;
    const firefox = args.includes('--firefox-id') ? args[args.indexOf('--firefox-id') + 1] : undefined;
    if (!chrome && !firefox) throw new Error('Provide --chrome-id or --firefox-id with the installed extension ID.');
    if (chrome && !/^[a-p]{32}$/.test(chrome)) throw new Error('Invalid Chrome extension ID');
    if (firefox && !/^[a-zA-Z0-9@._{}-]{1,128}$/.test(firefox)) throw new Error('Invalid Firefox extension ID');

    const targets: BrowserTarget[] = [];
    if (chrome) targets.push({ kind: 'chrome', extensionId: chrome });
    if (firefox) targets.push({ kind: 'firefox', extensionId: firefox });
    return targets;
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

function assertRegistrationsAvailable(paths: InstallationPaths, targets: BrowserTarget[]): void {
    for (const target of targets) {
        const value = readHostRegistration(target.kind);
        if (value && value !== manifestPath(paths, target.kind)) {
            throw new Error(`A different ${target.kind} host is registered; refusing to overwrite it.`);
        }
    }
}

function captureInstallationBackup(paths: InstallationPaths, targets: BrowserTarget[]): InstallationBackup {
    const manifestFiles = targets.map((target) => manifestPath(paths, target.kind));
    const files = new Map<string, Buffer | undefined>();
    for (const file of [paths.launcher, paths.record, ...manifestFiles]) {
        files.set(file, fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    }

    const registrations = new Map<BrowserKind, string | undefined>();
    for (const target of targets) registrations.set(target.kind, readHostRegistration(target.kind));
    return { files, registrations };
}

function writeSharedInstallationFiles(paths: InstallationPaths, previous: InstallationRecord, targets: BrowserTarget[]): void {
    // 批处理文件按 UTF-8 写入，先切换代码页再读取含中文的 Node / CLI 路径。
    fs.writeFileSync(paths.launcher, `@echo off\r\nchcp 65001 >nul\r\n"${process.execPath}" "${cli}" native-host\r\n`);
    const requestedKinds = targets.map((target) => target.kind);
    const record: InstallationRecord = {
        kinds: [...new Set([...previous.kinds, ...requestedKinds])],
        node: process.execPath,
        cli,
    };
    fs.writeFileSync(paths.record, JSON.stringify(record));
}

function createHostManifest(launcher: string, target: BrowserTarget) {
    const common = {
        name: HOST,
        description: 'Jiutouchong MCP bridge',
        path: launcher,
        type: 'stdio',
    };
    if (target.kind === 'chrome') {
        return { ...common, allowed_origins: [`chrome-extension://${target.extensionId}/`] };
    }
    return { ...common, allowed_extensions: [target.extensionId] };
}

function restoreInstallationBackup(paths: InstallationPaths, backup: InstallationBackup): void {
    for (const [kind, previousPath] of backup.registrations) {
        restoreHostRegistration(kind, previousPath, manifestPath(paths, kind));
    }
    for (const [file, contents] of backup.files) {
        if (contents) fs.writeFileSync(file, contents);
        else removeFileIfPresent(file);
    }
}

function removeFileIfPresent(file: string): void {
    if (fs.existsSync(file)) fs.unlinkSync(file);
}
