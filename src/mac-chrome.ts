import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { BrowserBrand } from './browser-identity.ts';

export const defaultChromeDataDir = () => path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const defaultEdgeDataDir = () => path.join(os.homedir(), 'Library/Application Support/Microsoft Edge');

// ps on macOS flattens argv. Keep spaces inside paths and ignore trailing
// positional arguments (e.g. a URL) after an existing user data directory.
function dataDirFromCommand(command: string, brand?: BrowserBrand): string | undefined {
    const browser = /^\/.*\/(Google Chrome|Microsoft Edge)\.app\/Contents\/MacOS\/\1(?:\s|$)/.exec(command)?.[1];
    if (!browser) return;
    const actual = browser === 'Microsoft Edge' ? 'edge' : 'chrome';
    if (brand && brand !== actual) return;
    const flag = /\s--user-data-dir(?:=|\s+)(.+?)(?=\s--|$)/.exec(command);
    if (!flag) return actual === 'edge' ? defaultEdgeDataDir() : defaultChromeDataDir();
    let value = flag[1].trim();
    while (path.isAbsolute(value)) {
        if (fs.statSync(path.join(value, 'Local State'), { throwIfNoEntry: false })?.isFile()) return value;
        const end = value.lastIndexOf(' ');
        if (end < 0) break;
        value = value.slice(0, end);
    }
}

function runningChromeDirs(brand?: BrowserBrand): Set<string> {
    const found = spawnSync('/usr/bin/pgrep', ['-u', String(process.getuid!()), '-x', '(Google Chrome|Microsoft Edge)'], { encoding: 'utf8' });
    const pids = found.stdout?.trim().split(/\s+/);
    if (found.status !== 0 || !pids?.every(pid => /^\d+$/.test(pid))) return new Set();
    const list = spawnSync('/bin/ps', ['-ww', '-p', pids.join(','), '-o', 'command='], { encoding: 'utf8' });
    const dirs = new Set<string>();
    for (const command of (list.stdout ?? '').split('\n')) {
        try {
            const dir = dataDirFromCommand(command.trim(), brand);
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

export function resolveChromeDataDir(extensionId: string, explicit?: string, fromRunningBrowser = false, brand?: BrowserBrand): string {
    if (explicit !== undefined) {
        if (!path.isAbsolute(explicit) || !fs.statSync(path.join(explicit, 'Local State'), { throwIfNoEntry: false })?.isFile()) {
            throw new Error('--chrome-user-data-dir 需要现有 Chrome 用户数据根目录的绝对路径（含 Local State）。');
        }
        return fs.realpathSync(explicit);
    }
    const dirs = runningChromeDirs(brand);
    // connect originates in a live browser. A single root is sufficient
    // even when macOS does not allow enumeration of the profile directory.
    if (fromRunningBrowser && dirs.size === 1) return [...dirs][0];
    const matches = [...dirs].filter(dir => hasExtension(dir, extensionId));
    const candidates = matches.length > 1 ? matches : fromRunningBrowser && !matches.length ? [...dirs] : [];
    if (candidates.length > 1) {
        throw new Error('请选择目标浏览器的数据目录，在接入命令最后加上 --chrome-user-data-dir "<目录>"。\n'
            + candidates.map((directory, index) => `  ${index + 1}. ${JSON.stringify(directory)}`).join('\n'));
    }
    return matches[0] ?? (brand === 'edge' ? defaultEdgeDataDir() : defaultChromeDataDir());
}
