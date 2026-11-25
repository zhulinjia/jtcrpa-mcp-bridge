import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { sessionEndpoint } from '../dist/paths.js';

export function canListenLocally(t) {
    if (process.platform !== 'darwin') return Promise.resolve(true);
    const endpoint = sessionEndpoint(randomBytes(16).toString('hex'));
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', error => {
            if (error.code !== 'EPERM' && error.code !== 'EACCES') {
                reject(error);
                return;
            }
            t.skip(`Local test socket unavailable: ${error.code}`);
            resolve(false);
        });
        server.listen(endpoint, () => server.close(error => error ? reject(error) : resolve(true)));
    });
}
