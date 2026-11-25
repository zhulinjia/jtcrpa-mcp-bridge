import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const dataModule = source => 'data:text/javascript,' + encodeURIComponent(source);
const substitute = dataModule(`
    import fs from 'node:fs';
    import path from 'node:path';
    const statePath = path.join(process.env.JTCRPA_BRIDGE_HOME, 'test-state.json');
    export async function callExtension(target, method) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.unconfirmed?.includes(target.expectedInstanceId)) throw new Error('BROWSER_RECOVERING');
        const title = state.online[target.expectedInstanceId];
        if (!title) throw new Error('BROWSER_OFFLINE');
        if (method === 'connection_status') return { connected: true, instanceId: target.expectedInstanceId };
        fs.appendFileSync(path.join(process.env.JTCRPA_BRIDGE_HOME, 'test-calls.txt'), JSON.stringify({ target, method }) + '\\n');
        if (method === 'browser_context') return { tabs: [{ tabId: 4, title, pageRef: 'a'.repeat(64) }] };
        return { ok: true };
    }
`);
const loader = dataModule(`
    export async function resolve(specifier, context, next) {
        if (context.parentURL?.includes('/dist/') && /(^|\\/)ipc\\.js$/.test(specifier)) {
            return { url: ${JSON.stringify(substitute)}, shortCircuit: true };
        }
        return next(specifier, context);
    }
`);
const preload = dataModule(`import { register } from 'node:module'; register(${JSON.stringify(loader)});`);

async function call(client, name, args) {
    const reply = await client.callTool({ name, arguments: args });
    return { isError: reply.isError, ...JSON.parse(reply.content[0].text) };
}

function browser(id, brand, label) {
    const kind = brand === 'firefox' ? 'firefox' : 'chrome';
    const extensionId = kind === 'chrome' ? 'a'.repeat(32) : 'test@example.invalid';
    return { id, kind, extensionId, instanceId: randomUUID(), bindingId: randomUUID(),
        routing: { brand, label, grantId: randomUUID() } };
}

test('unified stdio chooses only a sole confirmed browser and keeps each task on its authorized target', {
    skip: !['darwin', 'win32'].includes(process.platform), timeout: 15_000,
}, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-router-stdio-'));
    const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    const first = browser('c1', 'firefox', 'Store A');
    const second = browser('c2', 'firefox', 'Store B');
    const edge = browser('c3', 'edge', 'Test');
    const store = { nextId: 4, observed: [], connections: [first, second, edge], routerDefault: {
        bindingId: first.bindingId, expectedInstanceId: first.instanceId, grantId: first.routing.grantId,
    } };
    write('connections.json', store);
    write('test-state.json', { online: { [first.instanceId]: 'Store A orders', [edge.instanceId]: 'Edge test' } });

    const client = new Client({ name: 'unified-stdio-test', version: '1.0.0' });
    t.after(async () => { await client.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    await client.connect(new StdioClientTransport({
        command: process.execPath, args: ['--import', preload, cli, 'mcp', '--router'],
        env: { JTCRPA_BRIDGE_HOME: dir },
    }));
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes('browser_resolve'));

    const [choice, pickFirefox, pickEdge, chooseFirefox] = await Promise.all([
        call(client, 'browser_resolve', {}),
        call(client, 'browser_resolve', { target: 'Store A' }),
        call(client, 'browser_resolve', { target: 'Edge' }),
        call(client, 'browser_resolve', { target: '火狐' }),
    ]);
    assert.equal(choice.status, 'needs_selection');
    assert.deepEqual(choice.candidates.map(item => item.status), ['online', 'offline', 'online']);
    assert.equal(pickFirefox.status, 'selected');
    assert.equal(pickEdge.status, 'selected');
    assert.equal(chooseFirefox.status, 'needs_selection');
    assert.deepEqual(chooseFirefox.candidates.map(item => item.status), ['online', 'offline']);

    const [contextA, contextB] = await Promise.all([
        call(client, 'browser_context', { targetRef: pickFirefox.targetRef }),
        call(client, 'browser_context', { targetRef: pickEdge.targetRef }),
    ]);
    assert.equal(contextA.browserName, 'Firefox · Store A');
    assert.equal(contextA.tabs[0].title, 'Store A orders');
    assert.equal(contextB.tabs[0].title, 'Edge test');
    const invalid = await call(client, 'page_close', {
        targetRef: pickEdge.targetRef, tabId: 4, pageRef: contextA.tabs[0].pageRef, requestId: randomUUID(), userRequested: true,
    });
    assert.equal(invalid.error, 'RESOURCE_TARGET_MISMATCH');

    write('test-state.json', { online: { [edge.instanceId]: 'Edge test' }, unconfirmed: [first.instanceId] });
    const recovering = await call(client, 'browser_resolve', {});
    assert.equal(recovering.status, 'needs_selection');
    assert.equal(recovering.candidates[0].status, 'unconfirmed');

    write('test-state.json', { online: { [edge.instanceId]: 'Edge test' } });
    const offline = await call(client, 'browser_resolve', { target: 'Store A' });
    assert.equal(offline.status, 'offline');
    assert.equal(offline.browser.id, first.id);
    assert.equal((await call(client, 'browser_context', { targetRef: pickFirefox.targetRef })).error, 'BROWSER_OFFLINE');
    assert.equal((await call(client, 'browser_resolve', {})).targetRef, pickEdge.targetRef);

    first.routing.grantId = randomUUID();
    write('connections.json', store);
    assert.equal((await call(client, 'browser_context', { targetRef: pickFirefox.targetRef })).error, 'ROUTER_ACCESS_REVOKED');
    assert.equal((await call(client, 'browser_resolve', {})).targetRef, pickEdge.targetRef);

    write('test-state.json', { online: {} });
    const allOffline = await call(client, 'browser_resolve', {});
    assert.equal(allOffline.status, 'offline');
    assert.ok(allOffline.candidates.every(item => item.status === 'offline'));
    const dispatched = fs.readFileSync(path.join(dir, 'test-calls.txt'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(dispatched.length, 2);
    assert.deepEqual(new Set(dispatched.map(entry => entry.target.expectedInstanceId)), new Set([first.instanceId, edge.instanceId]));
});
