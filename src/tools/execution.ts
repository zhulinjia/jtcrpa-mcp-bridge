import { z } from 'zod/v4';
import { pageTargetFields, type ForwardedToolDefinition } from './definition.ts';

export const executionTools: ForwardedToolDefinition[] = [
    {
        name: 'workflow_run',
        description:
            '在明确的网页标签页中执行已保存的用户工作流，可能产生真实外部操作。' +
            '新建或修改流程保存后，必须先询问用户是否现在执行，等待本次保存之后的明确确认，不能因任务包含“采集”或保存成功就自动启动。' +
            '用户直接要求运行已有工作流时，可按该明确指令调用。' +
            'requestId 必须为 UUID。返回原始 ok、runId、error；runId 只表示运行已建档，不代表已经完成，请通过 run_get 查询。' +
            '超时后先查询 connection_status(requestId) 和最近运行，不得自动更换请求编号再次启动。' +
            '即使返回 ok:false，只要带有 runId，也表示这次运行已有记录。',
        schema: z.object({
            requestId: z.uuid(),
            workflowId: z.number().int().positive(),
            ...pageTargetFields,
        }),
        readOnly: false,
        openWorld: true,
    },
    {
        name: 'run_get',
        description:
            '读取指定 runId 的引擎真实状态及最近日志元数据。logLimit=0 时跳过日志加载，最多读取 50 条。' +
            '省略 runId 时列出最近运行（limit<=20），可按 workflowId 筛选，用于核对结果不明的启动请求。' +
            '结果为实时读取，不保证原子快照。不返回工作流 AST、运行变量、原始日志参数或结果。' +
            '查不到记录不能证明一次超时的启动从未发生。',
        schema: z.object({
            runId: z.string().min(1).max(128).optional(),
            workflowId: z.number().int().positive().optional(),
            limit: z.number().int().min(1).max(20).optional(),
            logLimit: z.number().int().min(0).max(50).optional(),
        }),
        readOnly: true,
        openWorld: false,
    },
    {
        name: 'run_control',
        description:
            '在用户明确授权后，使用 UUID 格式的 requestId，对指定运行执行暂停、恢复或结束。' +
            '恢复可能继续执行真实工作流动作。暂停阻止后续推进，但已在途的页面动作仍可能完成；结束不会回滚既有副作用。' +
            '保留原引擎规则：abort 的终态为 FAILED，并记录 run:aborted，不新增 CANCELLED 状态。' +
            '通过 run_get 查询当前状态；操作结果不明时先查询 connection_status(requestId)，不得自动重放。',
        schema: z.object({
            requestId: z.uuid(),
            runId: z.string().min(1).max(128),
            action: z.enum(['pause', 'resume', 'abort']),
        }),
        readOnly: false,
        openWorld: true,
    },
];
