import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetTools } from '../dist/tools/datasets.js';

const readSchema = datasetTools.find((tool) => tool.name === 'dataset_read').schema;

for (const identity of ['datasetId', 'datasetName']) {
    test(`dataset_read accepts long ${identity} without changing the identity`, () => {
        const value = 'a'.repeat(257);
        assert.deepEqual(readSchema.parse({ [identity]: value }), { [identity]: value });
    });

    test(`dataset_read rejects an empty ${identity}`, () => {
        assert.equal(readSchema.safeParse({ [identity]: '' }).success, false);
    });
}
