import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const defaultChromeDataDir = () => path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

// ps on macOS flattens argv. Keep spaces inside paths and ignore trailing
// positional arguments (e.g. a URL) after an existing user data directory.
function dataDirFromCommand(command: string): string | undefined {
    if (!/^\/.*\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome(?:\s|$)/.test(command)) return;
    const flag = /\s--user-data-dir(?:=|\s+)(.+?)(?=\s--|$)/.exec(command);
    if (!flag) return defaultChromeDataDir();
    let value = flag[1].trim();
    while (path.isAbsolute(value)) {
        if (fs.statSync(path.join(value, 'Local State'), { throwIfNoEntry: false })?.isFile()) return value;
        const end = value.lastIndexOf(' ');
        if (end < 0) break;
        value = value.slice(0, end);
    }
}

function runningChromeDirs(): Set<string> {
    const found = spawnSync('/usr/bin/pgrep', ['-u', String(process.getuid!()), '-x', 'Google Chrome'], { encoding: 'utf8' });
    const pids = found.stdout?.trim().split(/\s+/);
    if (found.status !== 0 || !pids?.every(pid => /^\d+$/.test(pid))) return new Set();
    const list = spawnSync('/bin/ps', ['-ww', '-p', pids.join(','), '-o', 'command='], { encoding: 'utf8' });
    const dirs = new Set<string>();
    for (const command of (list.stdout ?? '').split('\n')) {
        try {
            const dir = dataDirFromCommand(command.trim());
            if (dir) dirs.add(fs.realpathSync(dir));
        } catch { /* The process may exit or its profile may be inaccessible. */ }
    }
    return dirs;
}

function hasExtension(root: string, extensionId: string): boolean {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const profile = path.join(root, entry.name);
        for (const file of ['Secure Preferences', 'Preferences']) {
            try {
                const prefs = JSON.parse(fs.readFileSync(path.join(profile, file), 'utf8'));
                if (Object.hasOwn(prefs?.extensions?.settings ?? {}, extensionId)) return true;
            } catch { /* Most children are not profiles; a running profile may also be updating its preferences. */ }
        }
    }
    return false;
}

export function resolveChromeDataDir(extensionId: string, explicit?: string): string {
    if (explicit !== undefined) {
        if (!path.isAbsolute(explicit) || !fs.statSync(path.join(explicit, 'Local State'), { throwIfNoEntry: false })?.isFile()) {
            throw new Error('--chrome-user-data-dir 需要现有 Chrome 用户数据根目录的绝对路径（含 Local State）。');
        }
        return fs.realpathSync(explicit);
    }
    const dirs = runningChromeDirs();
    const matches = [...dirs].filter(dir => hasExtension(dir, extensionId));
    if (matches.length > 1) {
        throw new Error('多个运行中的 Chrome 用户数据目录含此扩展，请用 --chrome-user-data-dir 指定目标目录。');
    }
    return matches[0] ?? defaultChromeDataDir();
}
