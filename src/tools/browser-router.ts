import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { requireBrowserTarget, resolveBrowser } from '../browser-router.ts';
import { callExtension } from '../ipc.ts';
import type { ForwardedToolDefinition } from './definition.ts';
import { toToolResult } from './forwarded.ts';
import { routedSchema, scopeResources, translateResources } from './router-resources.ts';

const connectionTools: ForwardedToolDefinition[] = [
    {
        name: 'connection_status',
        description: '查询所选浏览器配置的连接状态。写入结果不明确时，使用原 targetRef 和原 requestId 查回执。',
        schema: z.object({ requestId: z.uuid().optional() }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'connection_ping',
        description: '向所选浏览器发送简短文本并原样返回，验证完整通信往返。',
        schema: z.object({ text: z.string().max(128) }),
        readOnly: true,
        openWorld: false,
    },
];

function describeTool(definition: ForwardedToolDefinition) {
    const description = definition.description.replaceAll('workflowId', 'workflowRef').replaceAll('runId', 'runRef')
        .replace('后续按真实 datasetId 或 datasetName 读取。', '后续使用返回的 datasetRef 读取。')
        .replace('必须且只能指定 datasetId 或 datasetName，按真实身份精确匹配，不用展示标题代替。', '使用同一目标的 dataset_list 返回的 datasetRef。');
    return description + ' 传入本任务的 targetRef，资源引用必须来自同一配置。';
}

export function registerBrowserRouterTools(server: McpServer, definitions: readonly ForwardedToolDefinition[]) {
    server.registerTool('browser_resolve', {
        description: '新任务开始前确定九头虫浏览器配置。只有用户明确指定时才传名称、品牌或连接编号。若返回 needs_selection 或目标不可用，把候选名称与状态告知用户。选定后后续调用使用返回的 targetRef。',
        inputSchema: z.strictObject({ target: z.string().trim().min(1).max(128).optional() }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ target }) => {
        try { return toToolResult(await resolveBrowser(target)); }
        catch { return toToolResult({ error: 'ROUTER_CONFIGURATION_UNAVAILABLE', message: '无法读取本机连接登记，请检查九头虫桥接器。' }); }
    });

    for (const definition of [...connectionTools, ...definitions]) {
        server.registerTool(definition.name, {
            description: describeTool(definition),
            inputSchema: routedSchema(definition.schema),
            annotations: {
                readOnlyHint: definition.readOnly,
                idempotentHint: definition.readOnly,
                destructiveHint: definition.destructive ?? !definition.readOnly,
                openWorldHint: definition.openWorld,
            },
        }, params => forwardRoutedTool(definition, params));
    }
}

async function forwardRoutedTool(definition: ForwardedToolDefinition, params: Record<string, unknown>) {
    let browserName: string | undefined;
    let dispatched = false;
    try {
        const targetRef = String(params.targetRef);
        const browser = requireBrowserTarget(targetRef);
        browserName = browser.name;
        const input = translateResources(browser.target, definition.name, params);
        const target = { ...browser.target, reportCodexAccess: !['connection_status', 'connection_ping'].includes(definition.name) };
        dispatched = true;
        const response = await callExtension(target, definition.name, input);
        const result = scopeResources(browser.target, definition.name, response);
        const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : { result };
        return toToolResult({ ...payload, targetRef, browserName });
    } catch (error) {
        const code = error instanceof Error ? error.message : 'BRIDGE_ERROR';
        return toToolResult({ error: code, browserName, message: explainFailure(code, browserName, dispatched && !definition.readOnly) });
    }
}

function explainFailure(error: string, browserName: string | undefined, write: boolean) {
    const name = browserName ?? '目标浏览器';
    switch (error) {
        case 'BROWSER_OFFLINE':
            return name + '已离线，请打开这份浏览器配置并开启九头虫 MCP。';
        case 'BROWSER_RECOVERING':
            return name + '正在恢复连接，请稍后检查原目标。';
        case 'INSTANCE_CONFLICT':
            return name + '的实例身份存在冲突，请在对应浏览器中检查连接。';
        case 'ROUTER_ACCESS_REVOKED':
        case 'CONNECTION_INSTANCE_MISMATCH':
        case 'CONNECTION_REMOVED':
            return name + '的通用访问已撤销或目标已变更，请核对后重新选择。';
        case 'RESOURCE_TARGET_MISMATCH':
            return '资源引用与本次浏览器配置不一致，请回到资源所属的配置或在新目标重新查询。';
        case 'WORKFLOW_REFERENCE_REQUIRED':
            return '更新工作流时，在 workflow 中使用同一浏览器的 workflowRef。';
        default:
            return write ? '结果可能未知。请使用原 targetRef 和 requestId 查询 connection_status，避免重复执行。' : undefined;
    }
}
