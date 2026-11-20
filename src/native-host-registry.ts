import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST } from './protocol.ts';

export type BrowserKind = 'chrome' | 'firefox';

function registryKey(kind: BrowserKind): string {
    const vendor = kind === 'chrome' ? 'Google\\Chrome' : 'Mozilla';
    return `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${HOST}`;
}

function runRegistryCommand(args: string[]) {
    return spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
}

export function readHostRegistration(kind: BrowserKind): string | undefined {
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

export function registerHost(kind: BrowserKind, manifest: string): void {
    const result = runRegistryCommand([
        'add', registryKey(kind), '/ve', '/t', 'REG_SZ', '/d', manifest, '/f',
    ]);
    if (result.status !== 0) throw new Error(`Host registration failed: ${result.stderr}`);
}

export function unregisterHost(kind: BrowserKind): void {
    const result = runRegistryCommand(['delete', registryKey(kind), '/f']);
    if (result.status !== 0) throw new Error(result.stderr || 'Registry removal failed');
}

export function restoreHostRegistration(kind: BrowserKind, previousPath: string | undefined, manifest: string): void {
    // 沿用既有尽力恢复策略，不将恢复命令失败改为新的异常。
    if (previousPath) {
        runRegistryCommand(['add', registryKey(kind), '/ve', '/t', 'REG_SZ', '/d', previousPath, '/f']);
    } else if (readHostRegistration(kind) === manifest) {
        runRegistryCommand(['delete', registryKey(kind), '/f']);
    }
}
