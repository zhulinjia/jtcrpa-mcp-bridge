import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { recordName, validInstance } from './protocol.ts';

export function bridgeRoot() {
    return path.resolve(process.env.JTCRPA_BRIDGE_HOME ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local'), 'Jtcrpa/McpBridge'));
}
export function instanceFile(id: string) {
    if (!validInstance(id)) throw new Error('INVALID_INSTANCE_ID');
    return path.join(bridgeRoot(), 'instances', recordName(id));
}
export interface Discovery { version: number; instanceId: string; session: string; pipe: string; token: string; pid: number }
export function readDiscovery(id: string): Discovery {
    const file = instanceFile(id);
    if (fs.statSync(file).size > 4096) throw new Error('INVALID_DISCOVERY');
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Discovery;
    if (record.version !== 1 || record.instanceId !== id || !/^\\\\\.\\pipe\\jtcrpa-mcp-[a-f0-9]{32}$/.test(record.pipe) || !/^[a-f0-9]{64}$/.test(record.token)) throw new Error('INVALID_DISCOVERY');
    return record;
}
