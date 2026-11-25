import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRequire } from 'node:module';
import { validInstance } from './protocol.ts';
import type { McpTarget } from './ipc.ts';
import { connectionName, findBinding } from './connections.ts';
import { registerConnectionTools } from './tools/connection.ts';
import { registerForwardedTools } from './tools/forwarded.ts';
import { authoringTools } from './tools/authoring.ts';
import { executionTools } from './tools/execution.ts';
import { datasetTools } from './tools/datasets.ts';
import { registerBrowserRouterTools } from './tools/browser-router.ts';

const description = '九头虫连接当前绑定的浏览器，可读取网页、创建和运行采集工作流、查询采集结果。';
const routerDescription = '九头虫连接用户授权的浏览器，可读取网页、创建和运行采集工作流、查询采集结果。';
const fixedInstructions = '当用户要查看当前浏览器页面、采集网页列表（包括滚动加载的内容）、编排或运行九头虫工作流、读取已采集的数据时，使用此服务。\n' +
    'For a workflow targeting a URL, use page_open on this server to open it in the bound browser. For an existing tab use browser_context. Pass the returned tabId and pageRef to this same server for inspection, saving and execution. Keep the page open after saving. Call page_close only when the user explicitly asks to close that specific page.';
const routerInstructions = '用九头虫读取网页、编排或运行采集工作流、查询采集数据。新任务先调用 browser_resolve，用户点名时传入明确目标。' +
    '遇到多个候选或原目标不可用，向用户展示名称和状态并等待选择。用户事先明确指定新任务的备用目标时，只在 browser_resolve 确认第一目标离线且业务尚未发出时选择备用目标。' +
    '同一任务继续沿用原 targetRef 和资源引用。用户要求切换时，从新增目标重新查询。首次操作告知用户实际使用的浏览器名称和网页标题。' +
    '用户提供 URL 时用 page_open，查看现有标签页时用 browser_context，并保留返回的 tabId、pageRef 和 targetRef。多个窗口的活动页面均可能匹配时，请用户选页。工作流、运行和数据集使用返回的 workflowRef、runRef 和 datasetRef。' +
    '编辑时把 workflowRef 放入 workflow 对象。保存后保留页面，并询问是否运行工作流。只有用户明确要求关掉指定页面时调用 page_close。';

export async function serveMcp(target?: McpTarget) {
    if (target !== undefined && !validInstance(typeof target === 'string' ? target : target.bindingId)) throw new Error('INVALID_MCP_TARGET');
    serveStdio(() => {
        const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
        const binding = !target || typeof target === 'string' || !target.expectedInstanceId ? undefined : findBinding(target.bindingId);
        const server = new McpServer({ name: 'jtcrpa', version, description: target === undefined ? routerDescription : description, ...(binding ? { title: '九头虫 · ' + connectionName(binding) } : {}) }, {
            instructions: target === undefined ? routerInstructions : fixedInstructions,
        });
        if (target === undefined) {
            registerBrowserRouterTools(server, [...authoringTools, ...executionTools, ...datasetTools]);
        } else {
            registerConnectionTools(server, target);
            registerForwardedTools(server, target, authoringTools);
            registerForwardedTools(server, target, executionTools);
            registerForwardedTools(server, target, datasetTools);
        }
        return server;
    });
}
