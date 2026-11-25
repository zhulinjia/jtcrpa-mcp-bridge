import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { instanceFile, sessionEndpoint } from '../dist/paths.js';
import { executionTools } from '../dist/tools/execution.js';
import { registerForwardedTools } from '../dist/tools/forwarded.js';

test('workflow_run forwards per-run inputs and preserves parameter errors', async (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-mcp-run-inputs-'));
    const previousHome = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = home;
    t.after(() => {
        if (previousHome === undefined) delete process.env.JTCRPA_BRIDGE_HOME;
        else process.env.JTCRPA_BRIDGE_HOME = previousHome;
        rmSync(home, { recursive: true, force: true });
    });

    const instanceId = randomUUID();
    const session = 'a'.repeat(32);
    mkdirSync(path.join(home, 'instances'));
    writeFileSync(instanceFile(instanceId), JSON.stringify({
        version: 1, instanceId, session, pipe: sessionEndpoint(session), token: 'b'.repeat(64), pid: process.pid,
    }));

    const requests = [];
    const issue = { name: 'page_count', reason: 'type', expectedType: 'number' };
    const success = { ok: true, runId: 'fixture-run' };
    const parameterError = { ok: false, error: 'Expected a number', parameterIssues: [issue] };
    const replies = new Map([[1, success], [2, parameterError]]);
    t.mock.method(net, 'createConnection', () => {
        const socket = new EventEmitter();
        socket.write = (payload) => {
            const { method, params } = JSON.parse(payload);
            assert.equal(method, 'workflow_run');
            requests.push(params);
            const result = replies.get(params.workflowId);
            queueMicrotask(() => socket.emit('data', Buffer.from(JSON.stringify({ ok: true, result }) + '\n')));
        };
        socket.destroy = () => socket.emit('close');
        queueMicrotask(() => socket.emit('connect'));
        return socket;
    });

    const server = new McpServer({ name: 'jtcrpa-test', version: '1.0.0' });
    registerForwardedTools(server, instanceId, executionTools);
    const client = new Client({ name: 'fixture-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(() => client.close());
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const runInputSchema = tools.tools.find(tool => tool.name === 'workflow_run').inputSchema;
    assert.equal(runInputSchema.properties.inputParams.type, 'object');
    assert.equal(runInputSchema.required.includes('inputParams'), false);

    const start = { workflowId: 1, tabId: 7, pageRef: 'c'.repeat(64) };
    const run = args => client.callTool({ name: 'workflow_run', arguments: { ...start, ...args, requestId: randomUUID() } });
    const data = response => JSON.parse(response.content[0].text);

    assert.deepEqual(data(await run({})), success);
    assert.equal(Object.hasOwn(requests[0], 'inputParams'), false);

    const inputParams = { page_count: 0, enabled: false, filter: { tags: ['新品', null] } };
    assert.deepEqual(data(await run({ inputParams })), success);
    assert.deepEqual(requests[1].inputParams, inputParams);

    const invalid = await run({ workflowId: 2, inputParams: { page_count: '7' } });
    assert.equal(invalid.isError, true);
    assert.deepEqual(data(invalid), parameterError);
    assert.equal((await run({ inputParam: inputParams })).isError, true);
    assert.deepEqual(requests.map(request => request.workflowId), [1, 1, 2]);
});
