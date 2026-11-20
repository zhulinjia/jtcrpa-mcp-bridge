import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { removeConnection } from './install.ts';
import { listRunningHosts } from './paths.ts';
import { callExtension } from './ipc.ts';
import { getConnection, listConnections, readConnections, type Connection } from './connections.ts';

type List = ReturnType<typeof listConnections>;
const browserNames = { chrome: 'Chrome', firefox: 'Firefox' };
const states = { online: '在线', offline: '离线', unconfirmed: '待确认' } as const;
const candidateState = (online: boolean | null) => online === null ? '待确认' : online ? '在线' : '离线';

async function inspectConnections(): Promise<List> {
    const live = listRunningHosts();
    const uncertain = new Set<string>();
    // PID 可能被系统复用，列表通过现有管道询问扩展。响应超时的实例显示待确认。
    const confirmed = await Promise.all(live.map(async item => {
        if (!item.caller) return item;
        try {
            const reply = await callExtension(item.instanceId, 'connection_status', {}, 2000) as { connected?: boolean; instanceId?: string };
            if (reply?.connected === true && reply.instanceId === item.instanceId) return item;
            if (reply?.connected === false) return;
        } catch (error) {
            const failure = error as NodeJS.ErrnoException;
            if (failure.code === 'ENOENT' || failure.code === 'ECONNREFUSED' || failure.message === 'BROWSER_OFFLINE') return;
        }
        uncertain.add(item.instanceId);
        return item;
    }));
    return listConnections(confirmed.filter(item => item !== undefined), uncertain);
}

function printList(list: List): void {
    if (!list.connections.length) console.log('尚未登记连接。请从插件的 MCP 页面复制 jtcrpa-mcp.cmd add 命令。');
    for (const [i, item] of list.connections.entries()) {
        console.log(`${i + 1}. ${item.id}  ${browserNames[item.kind]}  ${item.extensionId}  ${states[item.status]}`);
        console.log('   目标实例  ' + (item.instanceId ?? '待选择实例'));
        for (const candidate of item.candidates.filter(x => x.instanceId !== item.instanceId)) {
            console.log(`   可选实例  ${candidate.instanceId}  ${candidateState(candidate.online)}`);
        }
        if (!item.instanceId && item.candidates.length) {
            const flag = item.kind === 'chrome' ? '--chrome-id' : '--firefox-id';
            const id = item.candidates.length === 1 ? item.candidates[0].instanceId : '<上方实例UUID>';
            console.log(`   选择目标  jtcrpa-mcp.cmd add ${flag} ${item.extensionId} --instance ${id}`);
        }
    }
    for (const id of list.unconfirmedInstances) console.log('待确认归属的实例  ' + id);
}

export async function listCommand(args: string[]): Promise<void> {
    const { values } = parseArgs({ args, options: { json: { type: 'boolean' } } });
    const list = await inspectConnections();
    if (values.json) console.log(JSON.stringify(list, null, 2));
    else printList(list);
}

async function selectForRemoval(): Promise<Connection | undefined> {
    const list = await inspectConnections();
    printList(list);
    if (!list.connections.length) return;
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    const lines = reader[Symbol.asyncIterator]();
    const ask = async (prompt: string) => {
        process.stdout.write(prompt);
        const line = await lines.next();
        if (line.done) throw new Error('输入已结束，操作已取消。');
        return line.value.trim();
    };
    try {
        const choice = await ask('选择连接序号或编号：');
        const item = /^\d+$/.test(choice) ? list.connections[Number(choice) - 1] : list.connections.find(row => row.id === choice);
        if (!item) throw new Error('连接编号不存在 ' + choice);
        console.log(`已选择 ${item.id}  ${browserNames[item.kind]}  ${item.extensionId}`);
        const confirmed = await ask('删除这条连接？[y/N] ');
        if (!/^(y|yes|是)$/i.test(confirmed)) { console.log('已取消。'); return; }
        return item;
    } finally { reader.close(); }
}

export async function removeCommand(args: string[]): Promise<void> {
    const { positionals } = parseArgs({ args, allowPositionals: true });
    if (positionals.length > 1) throw new Error('一次只可指定一个连接编号。');
    const id = positionals[0];
    const selected = id === undefined ? await selectForRemoval() : getConnection(readConnections(), id);
    if (!selected) return;
    await removeConnection(selected);
    console.log('已删除 ' + selected.id);
}
