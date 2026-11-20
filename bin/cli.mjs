#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const pkg = createRequire(import.meta.url)('../package.json');
const [command, ...args] = process.argv.slice(2);
const usage = [
    'Usage: jtcrpa-mcp <command>',
    '连接管理',
    '  list [--json]',
    '  add (--chrome-id <扩展ID> | --firefox-id <扩展ID>) [--instance <UUID>]',
    '  remove [连接编号]',
    '客户端接入',
    '  config (--connection <连接编号> | --instance <UUID>) [--client codex|claude|deepseek]',
    '  mcp (--connection <配置中的绑定UUID> | --instance <实例UUID>)',
    '维护',
    '  uninstall    清除当前用户的本机宿主登记',
    '  --version    显示桥接器版本',
].join('\n');
function targetOptions(config) {
    const options = { connection: { type: 'string' }, instance: { type: 'string' } };
    if (config) options.client = { type: 'string' };
    const { values, tokens } = parseArgs({ args, options, tokens: true });
    if (tokens.filter(t => t.name === 'connection' || t.name === 'instance').length !== 1) {
        throw new Error('Specify one --connection or --instance target.');
    }
    if (values.instance !== undefined && !/^[a-f0-9-]{36}$/.test(values.instance)) throw new Error('Invalid instance UUID');
    if (values.connection !== undefined && config && !/^c[1-9]\d*$/.test(values.connection)) throw new Error('Invalid connection number');
    if (values.connection !== undefined && !config && /^c[1-9]\d*$/.test(values.connection)) {
        throw new Error('请先用 jtcrpa-mcp config --connection ' + values.connection + ' 生成带绑定 UUID 的客户端配置。');
    }
    return values;
}
try {
    if (process.platform !== 'win32') throw new Error('This release supports native Windows only.');
    if (command === 'uninstall' && args.length === 1 && ['--help', '-h'].includes(args[0])) {
        console.log('Usage: jtcrpa-mcp uninstall\n清除当前用户的本机宿主登记和连接。请先关闭浏览器中的 MCP。');
    }
    else if (command === 'list') await (await import('../dist/connection-cli.js')).listCommand(args);
    else if (command === 'remove') await (await import('../dist/connection-cli.js')).removeCommand(args);
    else if (command === 'native-host') await (await import('../dist/native-host.js')).runNativeHost(args);
    else if (command === 'mcp') {
        const { connection, instance } = targetOptions(false);
        await (await import('../dist/mcp.js')).serveMcp(connection !== undefined ? { bindingId: connection } : instance);
    }
    else if (command === 'add' || command === 'uninstall') await (await import('../dist/install.js')).manageHostRegistration(command, args);
    else if (command === 'config') {
        const { connection, instance, client } = targetOptions(true);
        if (client !== undefined && !['codex', 'claude', 'deepseek'].includes(client)) throw new Error('Unknown client');
        const configs = await (await import('../dist/install.js')).clientConfig(connection ?? instance);
        const value = client ? configs[client] : configs;
        console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    else if (command === '--help' || command === '-h') console.log(usage);
    else if (command === '--version' || command === '-v') console.log(pkg.version);
    else throw new Error(usage);
} catch (error) { console.error(error.message); process.exitCode = 1; }
