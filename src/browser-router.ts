import { createHash } from 'node:crypto';
import { readConnections, type Connection } from './connections.ts';
import { callExtension } from './ipc.ts';
import { validInstance } from './protocol.ts';

const brands = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' } as const;
const brandTerms: Readonly<Record<string, keyof typeof brands>> = {
    '谷歌': 'chrome', '谷歌浏览器': 'chrome', '微软 edge': 'edge', '火狐': 'firefox', '火狐浏览器': 'firefox',
};

type BrowserProbe =
    | { status: 'online' }
    | { status: 'offline' }
    | { status: 'unconfirmed'; issue?: string };

export interface RoutedTarget {
    bindingId: string;
    expectedInstanceId: string;
    routingGrant: string;
}

interface BrowserConfiguration {
    id: string;
    name: string;
    alias?: string;
    brand: keyof typeof brands;
    target: RoutedTarget;
    targetRef: string;
}

function fromConnection(connection: Connection): BrowserConfiguration | undefined {
    const { id, bindingId, instanceId, routing } = connection;
    if (!validInstance(bindingId) || !validInstance(instanceId) || !routing || !validInstance(routing.grantId)) return;
    const brand = routing.brand ?? connection.kind;
    const alias = routing.label || undefined;
    const target = { bindingId, expectedInstanceId: instanceId, routingGrant: routing.grantId };
    const name = brands[brand] + ' · ' + (alias ?? id);
    const targetRef = createHash('sha256').update(JSON.stringify([bindingId, instanceId, routing.grantId])).digest('hex');
    return { id, name, alias, brand, target, targetRef };
}

function configurations(connections: Connection[]) {
    return connections.map(fromConnection).filter(browser => browser !== undefined);
}

export function requireBrowserTarget(targetRef: string) {
    const browser = configurations(readConnections().connections).find(item => item.targetRef === targetRef);
    if (!browser) throw new Error('ROUTER_ACCESS_REVOKED');
    return browser;
}

async function probe(browser: BrowserConfiguration): Promise<BrowserProbe> {
    try {
        const result = await callExtension(browser.target, 'connection_status', {}, 850);
        if (result && typeof result === 'object' && 'connected' in result && result.connected === true &&
            'instanceId' in result && result.instanceId === browser.target.expectedInstanceId) return { status: 'online' };
    } catch (error) {
        if (error instanceof Error) {
            if (error.message === 'BROWSER_OFFLINE') return { status: 'offline' };
            if (['INSTANCE_CONFLICT', 'BROWSER_RECOVERING'].includes(error.message)) return { status: 'unconfirmed', issue: error.message };
        }
    }
    return { status: 'unconfirmed' };
}

function matchTarget(browsers: BrowserConfiguration[], hint: string) {
    const term = hint.toLowerCase();
    const exactId = browsers.find(browser => browser.id === term);
    if (exactId) return [exactId];
    const brand = Object.hasOwn(brandTerms, term) ? brandTerms[term] : term;
    return browsers.filter(browser => browser.name.toLowerCase() === term || browser.alias?.toLowerCase() === term || browser.brand === brand);
}

function browserSummary(browser: BrowserConfiguration, probe: BrowserProbe) {
    const { id, name, alias, brand } = browser;
    return { id, name, alias, brand, ...probe };
}

function browserUnavailable(browser: ReturnType<typeof browserSummary>) {
    if (browser.status === 'offline') return '已离线，请打开这份浏览器配置。';
    if (browser.status === 'unconfirmed') {
        if (browser.issue === 'INSTANCE_CONFLICT') return '的实例身份存在冲突，请在对应浏览器中检查连接。';
        if (browser.issue === 'BROWSER_RECOVERING') return '正在恢复连接，请稍后检查这份浏览器配置。';
    }
    return '的连接待确认，请检查这份浏览器配置。';
}

export async function resolveBrowser(hint?: string) {
    const browsers = configurations(readConnections().connections);
    const entries = await Promise.all(browsers.map(async config => ({ config, summary: browserSummary(config, await probe(config)) })));
    const candidates = entries.map(({ summary }) => summary);
    const choose = (entry: (typeof entries)[number]) => {
        const { config: { targetRef }, summary: browser } = entry;
        if (browser.status === 'online') return { status: 'selected', targetRef, browser };
        return {
            status: browser.status,
            browser,
            candidates,
            message: browser.name + browserUnavailable(browser),
        };
    };

    if (hint) {
        const matchedConfigurations = matchTarget(browsers, hint);
        const matches = entries.filter(({ config }) => matchedConfigurations.includes(config));
        if (matches.length === 1) return choose(matches[0]);
        if (matches.length > 1) return {
            status: 'needs_selection',
            candidates: matches.map(({ summary }) => summary),
            message: '请用户指定其中一份浏览器配置。',
        };
        return { status: 'not_found', candidates, message: '未找到该浏览器配置，请核对名称或先在目标浏览器授权。' };
    }

    if (!browsers.length) return {
        status: 'no_targets', candidates, message: '请在目标浏览器的九头虫设置中开启 MCP 连接。',
    };
    const online = entries.filter(({ summary }) => summary.status === 'online');
    const unconfirmed = candidates.some(browser => browser.status === 'unconfirmed');
    if (!unconfirmed && online.length === 1) return choose(online[0]);
    if (!unconfirmed && !online.length) return { status: 'offline', candidates, message: '当前授权的浏览器配置均离线，请打开要使用的配置。' };
    return { status: 'needs_selection', candidates, message: '请用户选择本次操作的浏览器配置。' };
}
