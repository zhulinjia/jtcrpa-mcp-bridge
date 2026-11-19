import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { verifySdkConnection } from './sdk-client.mjs';

test('official MCP SDK initializes and discovers tools while browser is offline', { timeout: 15000 }, async () => {
    await verifySdkConnection(randomUUID(), false);
});
