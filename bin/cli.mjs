#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2);
try {
    if (process.platform !== 'win32') throw new Error('This release supports native Windows only.');
    if (command === 'native-host') await (await import('../dist/native-host.js')).runNativeHost();
    else if (command === 'mcp') await (await import('../dist/mcp.js')).serveMcp(args[args.indexOf('--instance') + 1]);
    else if (command === 'install' || command === 'uninstall') await (await import('../dist/install.js')).install(command, args);
    else if (command === 'config') {
        const configs = (await import('../dist/install.js')).clientConfig(args[args.indexOf('--instance') + 1]);
        const client = args.includes('--client') ? args[args.indexOf('--client') + 1] : undefined;
        if (client && !Object.hasOwn(configs, client)) throw new Error('Unknown client');
        const value = client ? configs[client] : configs;
        console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    else if (command === 'instances') console.log(JSON.stringify((await import('../dist/install.js')).listInstances(), null, 2));
    else throw new Error('Usage: jtcrpa-mcp install --chrome-id <id> --firefox-id <id> | uninstall | instances | config --instance <id> | mcp --instance <id>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
