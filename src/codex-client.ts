import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface StdioTransport { type: 'stdio'; command: string; args: string[] }
interface Server { name: string; enabled: boolean; transport: StdioTransport | { type: 'streamable_http' } }
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

function codexCommand(args: string[]) {
    let executable = 'codex';
    let batch = false;
    if (process.platform === 'win32') {
        const paths = (process.env.PATH ?? '').split(path.delimiter).map(dir => dir.replace(/^"|"$/g, '')).filter(dir => path.isAbsolute(dir));
        const found = paths.flatMap(dir => ['codex.exe', 'codex.cmd', 'codex.bat'].map(file => path.join(dir, file))).find(file => fs.existsSync(file));
        if (!found) throw new Error('请先安装 Codex CLI，确保此终端能够运行 codex。');
        executable = found;
        batch = !found.toLowerCase().endsWith('.exe');
        if (batch) {
            const parts = [found, ...args];
            if (parts.some(part => /["%\r\n]/.test(part))) throw new Error('Unsupported character in Windows Codex command path or argument');
            // cmd /s strips one outer quote pair. Every argument keeps its own quotes through the npm/pnpm shim.
            args = ['/d', '/v:off', '/s', '/c', '"' + parts.map(part => '"' + part + '"').join(' ') + '"'];
            executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
        }
    }
    return { executable, args, batch };
}

function runMcpConfig(action: 'list' | 'add' | 'remove', options: string[]): string {
    const { executable, args, batch } = codexCommand(['mcp', action, ...options]);
    const result = spawnSync(executable, args, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        windowsVerbatimArguments: batch, timeout: 20_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || 'Codex MCP 配置失败。');
    return result.stdout ?? '';
}

// Recreating a server with "mcp add" would drop custom settings or named tool rules.
// Only migrate our original command/args table (0.5.0 also wrote enabled=false).
function isDefaultLegacyRegistration(server: Server): boolean {
    const { name } = server;
    const file = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml');
    if (!fs.existsSync(file)) return false;
    const config = fs.readFileSync(file, 'utf8');
    const mentions = config.match(new RegExp('(?<![\\w-])' + name + '(?![\\w-])', 'g'));
    if (mentions?.length !== 1 || config.includes('mcp__' + name + '__')) return false;
    const sections = config.replace(/\r\n/g, '\n').split(/(?=^\[)/m);
    const header = '[mcp_servers.' + name + ']\n';
    const table = sections.find(section => section.startsWith(header));
    const parent = sections.find(section => section.startsWith('[mcp_servers]\n'));
    const root = sections[0]?.startsWith('[') ? '' : sections[0];
    // The Codex config writer can serialize the same entry as an inline table.
    const fields = table?.slice(header.length) ??
        parent?.match(new RegExp('^' + name + '\\s*=\\s*\\{(.*)\\}\\s*$', 'm'))?.[1] ??
        root?.match(new RegExp('^mcp_servers\\.' + name + '\\s*=\\s*\\{(.*)\\}\\s*$', 'm'))?.[1];
    if (!fields) return false;
    // Values have already been checked against the registered transport by Codex.
    const shape = fields.replace(/"(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*'/g, '@')
        .replace(/#[^\n]*/g, '').replace(/\s/g, '');
    return shape.includes('enabled=false') === !server.enabled && shape.includes('command=@') && shape.includes('args=[') &&
        shape.replace(/command=@|enabled=(?:true|false)|args=\[@(?:,@)*,?\]|,/g, '') === '';
}

function matchesRegistration(server: Server, args: string[]): boolean {
    return server.transport.type === 'stdio' && server.transport.command === process.execPath &&
        JSON.stringify(server.transport.args) === JSON.stringify(args);
}

function isGeneratedName(name: string, base: string): boolean {
    return name.startsWith(base) && /^(?:_(?:[2-9]|[1-9]\d+))?$/.test(name.slice(base.length));
}

function requireEnabled(server: Server): void {
    if (!server.enabled) throw new Error('Codex 中的 MCP 服务 ' + server.name + ' 已停用。请在 Codex 中启用此服务后重新接入。');
}

export function configureServer(bindingId: string, instanceId: string, browser: string, previous?: string): string {
    const servers: Server[] = JSON.parse(runMcpConfig('list', ['--json']));
    const args = [cli, 'mcp', '--connection', bindingId, '--expect-instance', instanceId];
    const base = 'jtcrpa_' + browser;
    const legacyBase = base + '_' + bindingId.slice(0, 8);
    const saved = previous && /^[a-zA-Z0-9_-]+$/.test(previous) ? previous : undefined;
    const matching = servers.filter(server => matchesRegistration(server, args));
    const legacy = matching.find(server => (!saved || server.name === saved) && isGeneratedName(server.name, legacyBase));
    if (legacy && ((!legacy.enabled && legacy.name !== saved) || !isDefaultLegacyRegistration(legacy))) {
        requireEnabled(legacy);
        return legacy.name;
    }

    let name = saved && !isGeneratedName(saved, legacyBase) ? saved : base;
    const existing = matching.find(server => server.name === name) ?? matching.find(server =>
        isGeneratedName(server.name, base) && !isGeneratedName(server.name, legacyBase));
    if (existing) {
        requireEnabled(existing);
        name = existing.name;
    } else {
        for (let suffix = 2; servers.some(server => server.name === name); suffix++) {
            name = base + '_' + suffix;
        }
        runMcpConfig('add', [name, '--', process.execPath, ...args]);
    }
    // An interrupted migration can reuse the short entry before retrying removal.
    if (legacy) runMcpConfig('remove', [legacy.name]);
    return name;
}
