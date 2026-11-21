import fs from 'node:fs';

// 写入者持有登记锁，读者只会看到完整的旧文件或新文件。
export function replaceFile(file: string, contents: string | Buffer, mode = 0o600): void {
    const temporary = file + '.tmp';
    try {
        fs.writeFileSync(temporary, contents, { mode });
        if (process.platform === 'darwin') fs.chmodSync(temporary, mode);
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
