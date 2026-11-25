import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { authoringTools } from '../dist/tools/authoring.js';
import { executionTools } from '../dist/tools/execution.js';
import { datasetTools } from '../dist/tools/datasets.js';
import { routedSchema, scopeResources, translateResources } from '../dist/tools/router-resources.js';

const newTarget = () => ({ bindingId: randomUUID(), expectedInstanceId: randomUUID(), routingGrant: randomUUID() });
const targetRef = 'a'.repeat(64);

test('page references bind the tab, browser, and authorization', () => {
    const original = newTarget(), other = newTarget();
    const rawPageRef = 'f'.repeat(64);
    const { tabs: [page] } = scopeResources(original, 'browser_context', { tabs: [{ tabId: 7, pageRef: rawPageRef }] });
    const input = { targetRef, tabId: 7, pageRef: page.pageRef };
    assert.deepEqual(translateResources(original, 'page_probe', input), { tabId: 7, pageRef: rawPageRef });
    assert.throws(() => translateResources(original, 'page_probe', { ...input, tabId: 8 }), /RESOURCE_TARGET_MISMATCH/);
    assert.throws(() => translateResources(other, 'page_probe', input), /RESOURCE_TARGET_MISMATCH/);
    assert.throws(() => translateResources({ ...original, routingGrant: other.routingGrant }, 'page_probe', input), /RESOURCE_TARGET_MISMATCH/);
});

test('workflow, run and dataset references cannot cross browsers or resource kinds', () => {
    const original = newTarget(), other = newTarget();
    const { workflows: [{ workflowRef }] } = scopeResources(original, 'workflow_list', { workflows: [{ id: 7 }] });
    const { runRef } = scopeResources(original, 'workflow_run', { runId: '7' });
    const { datasets: [{ datasetRef }] } = scopeResources(original, 'dataset_list', { datasets: [{ id: '7' }] });
    for (const [method, ref, raw] of [
        ['workflow_get', { workflowRef }, { workflowId: 7 }],
        ['run_get', { runRef }, { runId: '7' }],
        ['dataset_read', { datasetRef }, { datasetId: '7' }],
    ]) {
        assert.deepEqual(translateResources(original, method, { targetRef, ...ref }), raw);
        assert.throws(() => translateResources(other, method, ref), /RESOURCE_TARGET_MISMATCH/);
    }
    assert.throws(() => translateResources(original, 'run_get', { runRef: datasetRef }), /RESOURCE_TARGET_MISMATCH/);
    assert.throws(() => translateResources(original, 'workflow_save', { workflow: { workflowId: 7 } }), /WORKFLOW_REFERENCE_REQUIRED/);
    assert.deepEqual(translateResources(original, 'workflow_save', { workflow: { workflowRef, name: 'Orders' } }),
        { workflow: { workflowId: 7, name: 'Orders' } });
});

test('request status scopes saved resource references without modifying business data', () => {
    const target = newTarget();
    const result = scopeResources(target, 'connection_status', {
        request: { method: 'workflow_run', result: { runId: 'run-42', workflowId: 3 } },
    });
    assert.deepEqual(translateResources(target, 'run_get', {
        runRef: result.request.result.runRef, workflowRef: result.request.result.workflowRef,
    }), { runId: 'run-42', workflowId: 3 });
    const rows = [{ workflowId: 2, pageRef: 'raw text', datasetId: 'spreadsheet value' }];
    assert.deepEqual(scopeResources(target, 'dataset_read', { datasetId: 'dataset', rows }).rows, rows);
});

test('router tool schemas require target and scoped references while fixed schemas accept original IDs', () => {
    const definitions = [...authoringTools, ...executionTools, ...datasetTools];
    const schema = method => definitions.find(definition => definition.name === method).schema;
    assert.equal(routedSchema(schema('browser_context')).safeParse({}).success, false);
    assert.equal(routedSchema(schema('workflow_get')).safeParse({ targetRef, workflowId: 1 }).success, false);
    assert.equal(routedSchema(schema('run_get')).safeParse({ targetRef }).success, true);
    assert.equal(routedSchema(schema('dataset_read')).safeParse({ targetRef, datasetName: 'Orders' }).success, false);
    assert.equal(schema('workflow_get').safeParse({ workflowId: 1 }).success, true);
    assert.equal(schema('dataset_read').safeParse({ datasetName: 'Orders' }).success, true);
});


test('router workflow contract explains source references and preserves the shared compiler guide', () => {
    const result = scopeResources(newTarget(), 'workflow_contract', {
        guide: 'Raw compiler guide', mcp: { instructions: 'Existing business rules.', mapping: { get: 'workflow_get' } },
    });
    assert.equal(result.guide, 'Raw compiler guide');
    assert.deepEqual(result.mcp.mapping, { get: 'workflow_get' });
    assert.match(result.mcp.instructions, /workflowRef/);
    assert.ok(result.mcp.instructions.endsWith('Existing business rules.'));
});
