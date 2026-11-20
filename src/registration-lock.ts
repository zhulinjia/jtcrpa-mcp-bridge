import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// 所有安装目录都操作当前用户的同一组 HKCU 注册项。Windows 在进程退出时释放管道名。
const user = createHash('sha256').update(homedir().toLowerCase()).digest('hex');
const endpoint = `\\\\.\\pipe\\jtcrpa-mcp-registration-${user}`;

export async function acquireRegistrationLock(): Promise<Server> {
    const deadline = Date.now() + 15000;
    for (;;) {
        const server = createServer(socket => socket.destroy());
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(endpoint, resolve);
            });
            return server;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
            if (Date.now() >= deadline) throw new Error('Another bridge command is updating registrations. Try again.');
            await delay(100);
        }
    }
}

export async function withRegistrationLock<T>(action: () => T): Promise<T> {
    const lock = await acquireRegistrationLock();
    try {
        return action();
    } finally {
        await new Promise<void>(resolve => lock.close(() => resolve()));
    }
}
