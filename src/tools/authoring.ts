import { z } from 'zod/v4';
import { pageTargetFields, type ForwardedToolDefinition } from './definition.ts';

const pageProbeNames = [
    'snapshot',
    'queryFrames',
    'probeElement',
    'probeExtract',
    'probeClick',
    'probeScroll',
    'networkCatalog',
    'networkSnapshot',
    'probeNetwork',
] as const;
const capabilityProbeNames = ['probeUserScript', 'probeFileAccess', 'probeFeishu'] as const;

export const authoringTools: ForwardedToolDefinition[] = [
    {
        name: 'browser_context',
        description: '列出绑定浏览器中的网页及其 tabId、pageRef。用户提供目标网址时可直接调用 page_open。',
        schema: z.object({}),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'page_open',
        description: '在此服务绑定的浏览器打开用户指定的 HTTP(S) 网址，唯一精确匹配时切换到已有标签页，否则新建活动标签页。返回实例、tabId、pageRef 和实际网址。编排时在同一服务使用该页，保存后保留。相同请求重用同一 requestId。',
        schema: z.object({ url: z.url({ protocol: /^https?$/ }), requestId: z.uuid() }),
        readOnly: false,
        destructive: false,
        openWorld: true,
    },
    {
        name: 'page_close',
        description: '仅在用户明确要求关闭指定标签页时调用，使用该页最近的 tabId 和 pageRef。工作流保存或编写完成后默认保留页面。用户的关页意图须来自当前对话。',
        schema: z.object({ ...pageTargetFields, requestId: z.uuid(), userRequested: z.literal(true) }),
        readOnly: false,
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
            probeTools: z.array(z.enum([...pageProbeNames, ...capabilityProbeNames, 'describeFile'])).max(6).optional(),
        }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'capability_probe',
        description: '检查绑定实例的用户脚本权限、本地文件读取能力或飞书凭据配置。仅查指定项，无需标签页。READY 只确认对应的本机条件；BLOCKED 按原因处理。检查失败时权限未知。设置改变后重新检查。',
        schema: z.object({ tool: z.enum(capabilityProbeNames) }).strict(),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'page_probe',
        description:
            '在明确的标签页及 Frame 中调用白名单编译期探针。先通过 workflow_contract 获取其 params Schema。' +
            '接口目录、响应样例及接口试采只读取已捕获的响应；接口探针省略 frameId 或传 0。' +
            '点击和滚动会真实操作页面，必须提供 requestId，且探测范围须在用户授权之内。' +
            'clean 通过现有沙箱执行。不提供任意 RPC 或 JavaScript 求值接口。',
        schema: z.object({
            tool: z.enum(pageProbeNames),
            ...pageTargetFields,
            frameId: z.number().int().nonnegative().optional(),
            params: z.record(z.string(), z.unknown()).optional(),
            requestId: z.uuid().optional(),
        }),
        readOnly: false,
        openWorld: true,
    },
    {
        name: 'file_describe',
        description: '预览用户在当前浏览器的九头虫「MCP 连接」页选定的一份文件，返回文件结构和少量样例。' +
            '只接受用户从该页面复制的临时文件引用。CSV 或 Excel 可用 hasHeader 复核首行。',
        schema: z.object({ fileRef: z.uuid(), hasHeader: z.boolean().optional() }).strict(),
        readOnly: true,
        openWorld: false,
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
            ...pageTargetFields,
            workflow: z.record(z.string(), z.unknown()),
        }),
        readOnly: false,
        openWorld: false,
    },
];
