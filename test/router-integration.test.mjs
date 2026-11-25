import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { nativeDecoder, nativeFrame, VERSION } from '../dist/protocol.js';
import { canListenLocally } from '../test-support/native-ipc.mjs';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

async function waitFor(assertion) {
    const deadline = Date.now() + 12_000;
    for (;;) {
        try { return await assertion(); }
        catch (error) {
            if (Date.now() >= deadline) throw error;
            await delay(50);
        }
    }
}

async function startPeer(t, env, target, grantId) {
    const caller = target.kind === 'firefox'
        ? [path.join(env.JTCRPA_BRIDGE_HOME, 'firefox.json'), target.extensionId]
        : ['chrome-extension://' + target.extensionId + '/'];
    const host = spawn(process.execPath, [cli, 'native-host', ...caller], { env: { ...process.env, ...env }, windowsHide: true });
    let stderr = '';
    host.stderr.on('data', chunk => { stderr += chunk; });
    const messages = [];
    const calls = [];
    const childClosed = new Promise(resolve => host.once('close', resolve));
    t.after(async () => { host.kill(); await childClosed; });
    const send = message => host.stdin.write(nativeFrame(message));
    host.stdout.on('data', nativeDecoder(message => {
        messages.push(message);
        if (message.type !== 'request') return;
        const { id, method, routingGrant } = message;
        assert.equal(routingGrant, grantId);
        if (method !== 'connection_status') calls.push(method);
        const result = method === 'connection_status' ? { connected: true, instanceId: target.instanceId } :
            { instanceId: target.instanceId, tabs: [{ tabId: 7, pageRef: 'f'.repeat(64), title: target.label, url: 'https://example.invalid/orders' }] };
        send({ type: 'response', id, ok: true, result });
    }));
    const router = { grantId, label: target.label, brand: target.brand };
    send({ type: 'hello', version: VERSION, instanceId: target.instanceId, extensionVersion: '9.9.9', router });
    await waitFor(() => {
        assert.equal(host.exitCode, null, JSON.stringify(messages) + stderr);
        assert.ok(messages.some(message => message.type === 'connected'), JSON.stringify(messages) + stderr);
    });
    return {
        calls, messages, router,
        configure: (values) => send({ type: 'router_settings', ...router, ...values }),
        close: async () => { host.stdin.end(); await childClosed; },
    };
}

async function sdkClient(t, config, env, name) {
    const client = new Client({ name, version: '1.0.0' });
    const transport = new StdioClientTransport({ command: config.command, args: config.args, env });
    await client.connect(transport);
    t.after(() => client.close());
    return client;
}

async function tool(client, name, args) {
    const reply = await client.callTool({ name, arguments: args });
    return { isError: reply.isError, ...JSON.parse(reply.content[0].text) };
}

test('the unified stdio entry discovers tools while no browser is connected', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-router-offline-'));
    try {
        const config = { command: process.execPath, args: [cli, 'mcp', '--router'] };
        const client = await sdkClient(t, config, { JTCRPA_BRIDGE_HOME: root }, 'router-offline');
        const { tools } = await client.listTools();
        assert.ok(tools.some(tool => tool.name === 'browser_resolve'));
        assert.ok(tools.find(tool => tool.name === 'browser_context').inputSchema.required.includes('targetRef'));
        assert.equal((await tool(client, 'browser_resolve', {})).status, 'no_targets');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('two MCP clients share named native hosts, preserve targets across restart and reject stale references', {
    skip: !['darwin', 'win32'].includes(process.platform), timeout: 90_000,
}, async t => {
    if (!await canListenLocally(t)) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-router-test-'));
    const env = { JTCRPA_BRIDGE_HOME: root };
    fs.mkdirSync(path.join(root, 'instances'));
    fs.writeFileSync(path.join(root, 'installation.json'), JSON.stringify({
        kinds: ['chrome', 'firefox'], node: process.execPath, cli,
    }));
    const first = { id: 'c1', kind: 'firefox', brand: 'firefox', extensionId: 'router@example.invalid', label: '店铺 A',
        instanceId: randomUUID(), bindingId: randomUUID() };
    const second = { id: 'c2', kind: 'chrome', brand: 'edge', extensionId: 'a'.repeat(32), label: '店铺 B',
        instanceId: randomUUID(), bindingId: randomUUID() };
    const registry = path.join(root, 'connections.json');
    fs.writeFileSync(registry, JSON.stringify({
        nextId: 3,
        connections: [first, second],
        observed: [],
    }));
    const grantA = randomUUID();
    const grantB = randomUUID();
    const firefox = await startPeer(t, env, first, grantA);
    const edge = await startPeer(t, env, second, grantB);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const config = await waitFor(() => {
        const selected = firefox.messages.find(message => message.type === 'router_state' && message.grantId === grantA);
        assert.ok(selected?.config?.mcpServers?.jtcrpa, JSON.stringify(firefox.messages));
        return selected.config.mcpServers.jtcrpa;
    });
    const [clientA, clientB] = await Promise.all([
        sdkClient(t, config, env, 'router-a'),
        sdkClient(t, config, env, 'router-b'),
    ]);
    assert.ok((await clientA.listTools()).tools.some(tool => tool.name === 'browser_resolve'));
    const [targetA, targetB] = await Promise.all([
        tool(clientA, 'browser_resolve', { target: 'Firefox' }),
        tool(clientB, 'browser_resolve', { target: 'Edge' }),
    ]);
    assert.equal(targetA.status, 'selected', JSON.stringify(targetA));
    assert.equal(targetB.status, 'selected', JSON.stringify(targetB));
    const [contextA, contextB] = await Promise.all([
        tool(clientA, 'browser_context', { targetRef: targetA.targetRef }),
        tool(clientB, 'browser_context', { targetRef: targetB.targetRef }),
    ]);
    assert.equal(contextA.instanceId, first.instanceId);
    assert.equal(contextB.instanceId, second.instanceId);
    assert.notEqual(contextA.tabs[0].pageRef, contextB.tabs[0].pageRef);
    const crossTarget = await tool(clientB, 'page_close', {
        targetRef: targetB.targetRef, tabId: 7, pageRef: contextA.tabs[0].pageRef, requestId: randomUUID(), userRequested: true,
    });
    assert.equal(crossTarget.isError, true);
    assert.deepEqual(edge.calls, ['browser_context']);

    await firefox.close();
    const offline = await tool(clientA, 'browser_context', { targetRef: targetA.targetRef });
    assert.equal(offline.isError, true);
    const namedOffline = await tool(clientA, 'browser_resolve', { target: 'Firefox' });
    assert.equal(namedOffline.status, 'offline');
    const onlyOnline = await tool(clientA, 'browser_resolve', {});
    assert.equal(onlyOnline.targetRef, targetB.targetRef);
    assert.deepEqual(edge.calls, ['browser_context']);
    const restarted = await startPeer(t, env, first, grantA);
    const afterRestart = await tool(clientA, 'browser_context', { targetRef: targetA.targetRef });
    assert.equal(afterRestart.instanceId, first.instanceId);
    assert.deepEqual(restarted.calls, ['browser_context']);

    restarted.configure({ grantId: null });
    await waitFor(() => assert.ok(restarted.messages.some(message => message.type === 'router_state' && message.grantId === null)));
    restarted.configure({ grantId: randomUUID() });
    await waitFor(() => assert.ok(restarted.messages.some(message => message.type === 'router_state' && message.grantId && message.grantId !== grantA)));
    assert.equal((await tool(clientA, 'browser_context', { targetRef: targetA.targetRef })).isError, true);
    assert.deepEqual(restarted.calls, ['browser_context']);
    await restarted.close();
    await edge.close();
});
