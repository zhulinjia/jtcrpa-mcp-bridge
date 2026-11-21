import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { macRuntimeDirectory } from './paths.ts';

// Registrations are shared across all installations belonging to one user.
async function tryRegistrationLock() {
    if (process.platform === 'darwin') {
        // Darwin fcntl.h exposes O_EXLOCK for open(2). Node accepts the flag
        // but does not export it. The kernel releases the lock on process exit.
        const O_EXLOCK = 0x20;
        const { O_CREAT, O_RDWR, O_NONBLOCK, O_NOFOLLOW } = fs.constants;
        const file = path.join(macRuntimeDirectory(), 'registration.lock');
        const fd = fs.openSync(file, O_CREAT | O_RDWR | O_EXLOCK | O_NONBLOCK | O_NOFOLLOW, 0o600);
        return { close(done: () => void) { fs.closeSync(fd); done(); } };
    }
    const user = createHash('sha256').update(homedir().toLowerCase()).digest('hex');
    const endpoint = `\\\\.\\pipe\\jtcrpa-mcp-registration-${user}`;
    const server = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, resolve);
    });
    return server;
}

export async function acquireRegistrationLock() {
    const deadline = Date.now() + 15000;
    for (;;) {
        try {
            return await tryRegistrationLock();
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EAGAIN' && code !== 'EADDRINUSE') throw error;
            if (Date.now() >= deadline) throw new Error('Another bridge command is updating registrations. Try again.');
            await delay(100);
        }
    }
}

export async function withRegistrationLock<T>(action: () => T): Promise<T> {
    const lock = await acquireRegistrationLock();
    try {
        return await action();
    } finally {
        await new Promise<void>(resolve => lock.close(() => resolve()));
    }
}
