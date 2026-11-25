import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bridgeRoot, listRunningHosts } from './paths.ts';
import { sameExtension, type BrowserBrand, type BrowserTarget } from './browser-identity.ts';
import { validInstance } from './protocol.ts';
import { withRegistrationLock } from './registration-lock.ts';
import { replaceFile } from './registration-files.ts';

export interface RouterGrant { grantId: string; label: string; brand?: BrowserBrand }
export interface RouterSettings {
    grantId: string | null;
    label: string;
    brand?: BrowserBrand;
}
export interface Connection extends BrowserTarget {
    id: string;
    instanceId: string | null;
    bindingId?: string;
    serverName?: string;
    codexServer?: string;
    label?: string;
    routing?: RouterGrant;
}
interface Observation extends BrowserTarget { instanceId: string }
export interface ConnectionStore {
    nextId: number;
    connections: Connection[];
    observed: Observation[];
    revokedInstances?: string[];
}

export function connectionName(connection: Connection): string {
    const brand = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }[connection.routing?.brand ?? connection.kind];
    const name = brand + ' · ' + connection.id;
    if (connection.routing) return connection.routing.label ? brand + ' · ' + connection.routing.label : name;
    return connection.label ? name + '（' + connection.label + '）' : name;
}

export const connectionFile = () => path.join(bridgeRoot(), 'connections.json');
export const validConnectionId = (id: string) => /^c[1-9]\d*$/.test(id);

export function readConnections(): ConnectionStore {
    const file = connectionFile();
    if (!fs.existsSync(file)) return { nextId: 1, connections: [], observed: [] };
    const store = JSON.parse(fs.readFileSync(file, 'utf8')) as ConnectionStore;
    if (!Number.isSafeInteger(store.nextId) || store.nextId < 1 || !Array.isArray(store.connections) || !Array.isArray(store.observed)
        || (store.revokedInstances !== undefined && (!Array.isArray(store.revokedInstances) || !store.revokedInstances.every(validInstance)))) {
        throw new Error('Invalid connections.json');
    }
    return store;
}

export function getConnection(store: ConnectionStore, id: string): Connection {
    const record = store.connections.find(item => item.id === id);
    if (!record) throw new Error('连接编号不存在 ' + id);
    return record;
}

export function findBinding(bindingId: string): Connection | undefined {
    return readConnections().connections.find(record => record.bindingId === bindingId);
}

export function bindingForConnection(id: string): Promise<string> {
    return withRegistrationLock(() => {
        const store = readConnections();
        const record = getConnection(store, id);
        if (!record.bindingId) {
            // 首次为升级前的登记生成客户端配置时，固定这条登记的身份。
            record.bindingId = randomUUID();
            replaceFile(connectionFile(), JSON.stringify(store));
        }
        return record.bindingId;
    });
}

export function addConnection(store: ConnectionStore, target: BrowserTarget, instanceId?: string): Connection {
    const matching = store.connections.filter(item => sameExtension(item, target));
    if (instanceId) checkObserved(store, target, instanceId);
    const existing = instanceId ? matching.find(item => item.instanceId === instanceId) ?? matching.find(item => !item.instanceId) : matching[0];
    if (existing) {
        if (instanceId) existing.instanceId = instanceId;
        return existing;
    }
    const record = { ...target, id: 'c' + store.nextId++, bindingId: randomUUID(), instanceId: instanceId ?? null };
    store.connections.push(record);
    return record;
}

function checkObserved(store: ConnectionStore, target: BrowserTarget, instanceId: string): void {
    if (isInstanceRevoked(store, instanceId)) throw new Error('CONNECTION_REMOVED');
    if (!validInstance(instanceId) || !store.observed.some(item => sameExtension(item, target) && item.instanceId === instanceId)) {
        throw new Error('该实例尚未通过这个扩展的握手，请先在相应浏览器中开启 MCP。');
    }
}

export async function rememberInstance(caller: BrowserTarget, instanceId: string): Promise<void> {
    await withRegistrationLock(() => {
        const store = readConnections();
        if (isInstanceRevoked(store, instanceId)) throw new Error('CONNECTION_REMOVED');
        if (!store.connections.some(item => sameExtension(item, caller))) throw new Error('EXTENSION_NOT_REGISTERED');
        if (store.observed.some(item => sameExtension(item, caller) && item.instanceId === instanceId)) return;
        store.observed.push({ ...caller, instanceId });
        replaceFile(connectionFile(), JSON.stringify(store));
    });
}

export function saveRouterSettings(caller: BrowserTarget, instanceId: string, settings: RouterSettings) {
    return withRegistrationLock(() => {
        const store = readConnections();
        const connection = store.connections.find(item => item.instanceId === instanceId && sameExtension(item, caller));
        const { grantId, label, brand } = settings;
        if (!connection?.bindingId) return { grantId, bound: false };

        const before = JSON.stringify(store);
        if (grantId === null) delete connection.routing;
        else connection.routing = { grantId, label, brand };
        const updated = JSON.stringify(store);
        if (updated !== before) replaceFile(connectionFile(), updated);
        return { grantId, bound: true, displayName: connectionName(connection) };
    });
}

export function isInstanceRevoked(store: ConnectionStore, instanceId: string): boolean {
    return store.revokedInstances?.includes(instanceId) === true;
}

export function revokeInstances(store: ConnectionStore, instanceIds: (string | null)[]): void {
    const revoked = new Set(instanceIds.filter(validInstance));
    if (!revoked.size) return;
    store.revokedInstances = [...new Set([...(store.revokedInstances ?? []), ...revoked])];
    store.observed = store.observed.filter(item => !revoked.has(item.instanceId));
}

export function listConnections(live = listRunningHosts(), uncertain: ReadonlySet<string> = new Set()) {
    const store = readConnections();
    const unconfirmed = live.filter(host => !isInstanceRevoked(store, host.instanceId) && (!host.caller
        || !store.connections.some(record => sameExtension(record, host.caller))
        || !store.observed.some(item => item.instanceId === host.instanceId && sameExtension(item, host.caller))));
    const connections = store.connections.map(record => {
        const candidates = store.observed.filter(item => sameExtension(record, item)).map(item => {
            const found = live.some(active => active.instanceId === item.instanceId && sameExtension(record, active.caller));
            return { instanceId: item.instanceId, online: found && uncertain.has(item.instanceId) ? null : found };
        });
        const selected = candidates.filter(item => !record.instanceId || record.instanceId === item.instanceId);
        const awaitingHandshake = unconfirmed.some(host => (!host.caller || sameExtension(record, host.caller))
            && (!record.instanceId || record.instanceId === host.instanceId));
        const status: 'online' | 'unconfirmed' | 'offline' = selected.some(item => item.online) ? 'online'
            : awaitingHandshake || selected.some(item => item.online === null) ? 'unconfirmed' : 'offline';
        const { id, kind, extensionId, instanceId, bindingId, label, codexServer } = record;
        return { id, kind, extensionId, instanceId, bindingId, label, codexServer, serverName: record.serverName ?? codexServer, status, candidates };
    });
    return { connections, unconfirmedInstances: unconfirmed.map(host => host.instanceId) };
}
