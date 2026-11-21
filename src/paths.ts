import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { recordName, validInstance } from './protocol.ts';
import type { BrowserTarget } from './browser-identity.ts';

export function bridgeRoot() {
    const base = process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local');
    return path.resolve(process.env.JTCRPA_BRIDGE_HOME ?? path.join(base, 'Jtcrpa/McpBridge'));
}

// A user's home and TMPDIR can both exceed Darwin's Unix socket path limit.
export function macRuntimeDirectory(): string {
    const uid = process.getuid!();
    const directory = `/tmp/jtcrpa-mcp-${uid}`;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
        throw new Error('Unsafe bridge runtime directory: ' + directory);
    }
    return directory;
}

export function sessionEndpoint(session: string): string {
    if (!/^[a-f0-9]{32}$/.test(session)) throw new Error('INVALID_DISCOVERY');
    return process.platform === 'darwin'
        ? path.join(macRuntimeDirectory(), session + '.sock')
        : `\\\\.\\pipe\\jtcrpa-mcp-${session}`;
}
export function instanceFile(id: string) {
    if (!validInstance(id)) throw new Error('INVALID_INSTANCE_ID');
    return path.join(bridgeRoot(), 'instances', recordName(id));
}
export interface Discovery { version: number; instanceId: string; session: string; pipe: string; token: string; pid: number; caller?: BrowserTarget }

export function listRunningHosts() {
    const directory = path.join(bridgeRoot(), 'instances');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
        try {
            const { instanceId, pid, caller } = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Discovery;
            if (!Number.isSafeInteger(pid) || pid <= 0) return [];
            try { process.kill(pid, 0); } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EPERM') return [];
            }
            return [{ instanceId, caller }];
        } catch { return []; }
    });
}
export function readDiscovery(id: string): Discovery {
    const file = instanceFile(id);
    if (fs.statSync(file).size > 4096) throw new Error('INVALID_DISCOVERY');
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Discovery;
    if (record.version !== 1 || record.instanceId !== id || record.pipe !== sessionEndpoint(record.session) || !/^[a-f0-9]{64}$/.test(record.token)) throw new Error('INVALID_DISCOVERY');
    return record;
}
