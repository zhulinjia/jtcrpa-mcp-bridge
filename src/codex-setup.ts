import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { checkExtensionId, sameExtension, type BrowserTarget } from './browser-identity.ts';
import { addConnection, connectionFile, connectionName, readConnections } from './connections.ts';
import { configureServer } from './codex-client.ts';
import { manageHostRegistration } from './install.ts';
import { callExtension } from './ipc.ts';
import { readDiscovery } from './paths.ts';
import { validInstance } from './protocol.ts';
import { replaceFile } from './registration-files.ts';
import { withRegistrationLock } from './registration-lock.ts';

async function waitForBrowser(target: BrowserTarget, instanceId: string, ticket: string) {
    const deadline = Date.now() + 120_000;
    for (;;) {
        try {
            const discovery = readDiscovery(instanceId);
            if (!sameExtension(target, discovery.caller)) throw new Error('CONNECTION_INSTANCE_MISMATCH');
            const reply = await callExtension(instanceId, 'codex_setup', { ticket }, 3500) as { instanceId?: string; label?: string };
            if (reply?.instanceId !== instanceId) throw new Error('CONNECTION_INSTANCE_MISMATCH');
            return typeof reply.label === 'string' ? reply.label.replace(/[\p{C}]/gu, '').trim().slice(0, 48) : '';
        } catch (error) {
            const failure = error as NodeJS.ErrnoException;
            if (failure.message === 'UNKNOWN_METHOD') throw new Error('请更新九头虫扩展和桥接器，重新开启连接后再接入。');
            if (failure.message === 'CODEX_SETUP_MISMATCH') throw new Error('这条命令已失效或属于另一份浏览器配置。请从目标浏览器重新接入。');
            if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(failure.code ?? '') &&
                !['BROWSER_OFFLINE', 'BRIDGE_TIMEOUT', 'BRIDGE_CLOSED'].includes(failure.message)) throw error;
            if (Date.now() >= deadline) throw new Error('等待目标浏览器超时。请回到发起接入的九头虫 MCP 页面查看状态，然后重试。');
            await delay(500);
        }
    }
}

export async function connectCodex(args: string[]) {
    const { values } = parseArgs({ args, options: { 'chrome-id': { type: 'string' }, 'firefox-id': { type: 'string' },
        instance: { type: 'string' }, setup: { type: 'string' } } });
    const chrome = values['chrome-id'], firefox = values['firefox-id'];
    const { instance: instanceId, setup: ticket } = values;
    if (Boolean(chrome) === Boolean(firefox) || !validInstance(instanceId) || !validInstance(ticket)) {
        throw new Error('请从目标浏览器复制完整的 Codex 接入命令。');
    }
    const target: BrowserTarget = chrome ? { kind: 'chrome', extensionId: chrome } : { kind: 'firefox', extensionId: firefox! };
    checkExtensionId(target.kind, target.extensionId);
    await manageHostRegistration('add', ['--' + target.kind + '-id', target.extensionId]);
    console.log('正在等待发起接入的浏览器…');
    const setup = await bindCodexBrowser(target, instanceId, ticket);
    console.log(setup.displayName + ' 已就绪。Codex MCP 服务名为 ' + setup.name);
}

export async function bindCodexBrowser(target: BrowserTarget, instanceId: string, ticket: string) {
    const label = await waitForBrowser(target, instanceId, ticket);
    const setup = await withRegistrationLock(() => {
        const store = readConnections();
        const connection = addConnection(store, target, instanceId);
        connection.bindingId ??= randomUUID();
        // A retry after a Codex/config write failure must reuse this exact binding.
        replaceFile(connectionFile(), JSON.stringify(store));
        const name = configureServer(connection.bindingId, instanceId, target.kind + '_' + connection.id, connection.codexServer);
        connection.codexServer = name;
        connection.label = label || undefined;
        replaceFile(connectionFile(), JSON.stringify(store));
        const displayName = connectionName(connection);
        return { name, displayName, bindingId: connection.bindingId };
    });
    await callExtension({ bindingId: setup.bindingId, expectedInstanceId: instanceId }, 'codex_setup',
        { ticket, bindingId: setup.bindingId, displayName: setup.displayName, serverName: setup.name });
    return setup;
}
