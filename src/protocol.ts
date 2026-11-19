import { createHash } from 'node:crypto';

export const VERSION = 1;
export const HOST = 'com.jtcrpa.mcp';
export const MAX_BYTES = 512 * 1024;
export const validInstance = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export const recordName = (id: string) => createHash('sha256').update(id).digest('hex') + '.json';

export function nativeFrame(value: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > MAX_BYTES) throw new Error('MESSAGE_TOO_LARGE');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    return Buffer.concat([header, body]);
}

export function nativeDecoder(onMessage: (value: unknown) => void) {
    let buffer: Buffer = Buffer.alloc(0);
    return (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const size = buffer.readUInt32LE();
            if (!size || size > MAX_BYTES) throw new Error('INVALID_FRAME_SIZE');
            if (buffer.length < size + 4) return;
            const value: unknown = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'));
            buffer = buffer.subarray(size + 4);
            onMessage(value);
        }
    };
}
