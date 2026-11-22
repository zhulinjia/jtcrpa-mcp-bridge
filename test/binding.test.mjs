import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { callExtension } from '../dist/ipc.js';
import { connectionName } from '../dist/connections.js';

test('browser display names distinguish identically labelled profiles', () => {
    const chrome = { kind: 'chrome', label: '工作' };
    assert.equal(connectionName({ ...chrome, id: 'c1' }), 'Chrome · c1（工作）');
    assert.equal(connectionName({ ...chrome, id: 'c2' }), 'Chrome · c2（工作）');
    assert.equal(connectionName({ kind: 'firefox', id: 'c3' }), 'Firefox · c3');
});

test('a removed or reassigned binding is rejected before a browser operation is dispatched', async t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jtcrpa-binding-'));
    const original = process.env.JTCRPA_BRIDGE_HOME;
    process.env.JTCRPA_BRIDGE_HOME = home;
    t.after(() => {
        if (original === undefined) delete process.env.JTCRPA_BRIDGE_HOME; else process.env.JTCRPA_BRIDGE_HOME = original;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const bindingId = randomUUID(), expectedInstanceId = randomUUID();
    await assert.rejects(callExtension({ bindingId, expectedInstanceId }, 'workflow_run'), /CONNECTION_REMOVED/);
    fs.writeFileSync(path.join(home, 'connections.json'), JSON.stringify({ nextId: 2, observed: [], connections: [
        { id: 'c1', bindingId, kind: 'chrome', extensionId: 'a'.repeat(32), instanceId: randomUUID() },
    ] }));
    await assert.rejects(callExtension({ bindingId, expectedInstanceId }, 'workflow_run'), /CONNECTION_INSTANCE_MISMATCH/);
});
