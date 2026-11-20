import { z } from 'zod/v4';
import type { ForwardedToolDefinition } from './definition.ts';

const probeNames = [
    'snapshot',
    'queryFrames',
    'probeElement',
    'probeExtract',
    'probeClick',
    'probeScroll',
] as const;

export const authoringTools: ForwardedToolDefinition[] = [
    {
        name: 'browser_context',
        description: '列出当前浏览器实例中的网页标签页摘要。调用页面探针或保存工作流前，先选定明确的 tabId。',
        schema: z.object({}),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'workflow_contract',
        description:
            '编排前先读取本契约，获取当前完整编译说明及可用节点工具。' +
            '按需请求节点和探针的详细 Schema，每次各最多 6 个。' +
            'emit* 定义用于在客户端本地构造节点，再通过 workflow_save 保存完整步骤。保存成功后必须询问用户是否执行并等待确认。未支持的探针不可用。',
        schema: z.object({
            includeGuide: z.boolean().optional(),
            nodeTools: z.array(z.string()).max(6).optional(),
            probeTools: z.array(z.enum(probeNames)).max(6).optional(),
        }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'page_probe',
        description:
            '在明确的标签页及 Frame 中调用白名单编译期探针。先通过 workflow_contract 获取其 params Schema。' +
            '点击和滚动会真实操作页面，必须提供 requestId，且探测范围须在用户授权之内。' +
            'clean 通过现有沙箱执行。不提供任意 RPC 或 JavaScript 求值接口。',
        schema: z.object({
            tool: z.enum(probeNames),
            tabId: z.number().int().positive(),
            frameId: z.number().int().nonnegative().optional(),
            params: z.record(z.string(), z.unknown()).optional(),
            requestId: z.uuid().optional(),
        }),
        readOnly: false,
        openWorld: true,
    },
    {
        name: 'workflow_list',
        description:
            '按名称或说明检索用户工作流，单次最多返回 5 个匹配项。' +
            'total 大于返回数量时请收窄查询关键词。结果不包含任务包装工作流。',
        schema: z.object({
            query: z.string().optional(),
        }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'workflow_get',
        description:
            '编辑前先读取已保存工作流的完整内容。保留无关节点和节点 ID，' +
            '并将返回的工作流 ID 传入 workflow_save.workflow.workflowId。',
        schema: z.object({
            workflowId: z.number().int().positive(),
        }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'workflow_save',
        description:
            '通过 commitWorkflow 校验并保存工作流。成功后说明保存结果及 warnings，询问用户是否现在执行，并等待本次保存之后的明确确认；不得自动调用 workflow_run。' +
            'workflow 包含 name、完整 steps，以及可选的 description、guide、sourceUrl、category、tags、workflowId。' +
            '修改已有步骤时先核对功能简述和使用方法，确认后在 workflow 中传 metadataReviewed: true。' +
            '先获取节点 Schema。沿用现有新增或更新语义，请检查返回的 updated 和 workflowId。' +
            '仅对相同参数复用 requestId；超时后先调用 connection_status(requestId) 查询，' +
            '不得盲目更换请求编号重试。',
        schema: z.object({
            requestId: z.uuid(),
            tabId: z.number().int().positive(),
            workflow: z.record(z.string(), z.unknown()),
        }),
        readOnly: false,
        openWorld: false,
    },
];
