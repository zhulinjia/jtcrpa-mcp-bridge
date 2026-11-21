import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChromeDataDir } from './mac-chrome.ts';
import { HOST } from './protocol.ts';

export type BrowserKind = 'chrome' | 'firefox';

function macRegistration(kind: BrowserKind, chromeDataDir?: string): string {
    const root = kind === 'chrome' ? chromeDataDir ?? defaultChromeDataDir() : path.join(os.homedir(), 'Library/Application Support/Mozilla');
    return path.join(root, 'NativeMessagingHosts', HOST + '.json');
}

function registryKey(kind: BrowserKind): string {
    const vendor = kind === 'chrome' ? 'Google\\Chrome' : 'Mozilla';
    return `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${HOST}`;
}

function runRegistryCommand(args: string[]) {
    return spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
}

export function readHostRegistration(kind: BrowserKind, chromeDataDir?: string): string | undefined {
    if (process.platform === 'darwin') {
        const file = macRegistration(kind, chromeDataDir);
        try {
            return path.resolve(path.dirname(file), fs.readlinkSync(file));
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') return undefined;
            if (code === 'EINVAL') return file; // Another installer owns this regular manifest.
            throw error;
        }
    }
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', fileURLToPath(new URL('../windows/read-registration.ps1', import.meta.url)),
        '-RegistryPath', registryKey(kind).slice('HKCU\\'.length),
    ], { encoding: 'utf8', windowsHide: true });
    // 脚本直接读取注册值并返回 UTF-8 JSON，避免解析 reg.exe 的本地代码页输出。
    if (result.status !== 0) throw new Error(`Could not read the ${kind} host registration: ${result.error?.message ?? result.stderr}`);
    const value: unknown = JSON.parse(result.stdout);
    return typeof value === 'string' ? value : undefined;
}

export function registerHost(kind: BrowserKind, manifest: string, chromeDataDir?: string): void {
    if (process.platform === 'darwin') {
        const file = macRegistration(kind, chromeDataDir);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.symlinkSync(manifest, file);
        return;
    }
    const result = runRegistryCommand([
        'add', registryKey(kind), '/ve', '/t', 'REG_SZ', '/d', manifest, '/f',
    ]);
    if (result.status !== 0) throw new Error(`Host registration failed: ${result.stderr}`);
}

export function unregisterHost(kind: BrowserKind, chromeDataDir?: string): void {
    if (process.platform === 'darwin') {
        fs.unlinkSync(macRegistration(kind, chromeDataDir));
        return;
    }
    const result = runRegistryCommand(['delete', registryKey(kind), '/f']);
    if (result.status !== 0) throw new Error(result.stderr || 'Registry removal failed');
}

export function restoreHostRegistration(kind: BrowserKind, previousPath: string | undefined, manifest: string, chromeDataDir?: string): void {
    if (process.platform === 'darwin') {
        if (readHostRegistration(kind, chromeDataDir) === manifest) unregisterHost(kind, chromeDataDir);
        return;
    }
    // 沿用既有尽力恢复策略，不将恢复命令失败改为新的异常。
    if (previousPath) {
        runRegistryCommand(['add', registryKey(kind), '/ve', '/t', 'REG_SZ', '/d', previousPath, '/f']);
    } else if (readHostRegistration(kind) === manifest) {
        runRegistryCommand(['delete', registryKey(kind), '/f']);
    }
}
