import { createHmac, timingSafeEqual } from 'node:crypto';
import { z, type ZodType, type ZodObject } from 'zod/v4';
import { MAX_BYTES } from '../protocol.ts';
import type { RoutedTarget } from '../browser-router.ts';

type Fields = Record<string, unknown>;
type Kind = 'page' | 'workflow' | 'run' | 'dataset';

const browserRef = z.string().regex(/^[a-f0-9]{64}$/).describe('使用 browser_resolve 返回的 targetRef。');
const sourceRef = z.string().min(1).max(MAX_BYTES);
const pageValue = z.tuple([z.number().int().positive(), z.string().regex(/^[a-f0-9]{64}$/)]);
const workflowValue = z.number().int().positive();
const runValue = z.string().min(1).max(128);
const datasetValue = z.string().min(1);

const fieldsOf = (value: unknown): Fields | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;

function sign(target: RoutedTarget, kind: Kind, payload: string) {
    return createHmac('sha256', target.routingGrant).update(JSON.stringify([target.bindingId, target.expectedInstanceId, kind, payload])).digest();
}

function scopedRef(target: RoutedTarget, kind: Kind, value: unknown) {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return payload + '.' + sign(target, kind, payload).toString('hex');
}

function readScoped<T>(target: RoutedTarget, kind: Kind, ref: unknown, schema: ZodType<T>): T {
    const match = typeof ref === 'string' && /^([a-z0-9_-]+)\.([a-f0-9]{64})$/i.exec(ref);
    if (!match || !timingSafeEqual(sign(target, kind, match[1]), Buffer.from(match[2], 'hex'))) throw new Error('RESOURCE_TARGET_MISMATCH');
    let value: unknown;
    try { value = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
    catch { throw new Error('RESOURCE_TARGET_MISMATCH'); }
    const checked = schema.safeParse(value);
    if (!checked.success) throw new Error('RESOURCE_TARGET_MISMATCH');
    return checked.data;
}

export function routedSchema(schema: ZodObject) {
    const fields: Record<string, ZodType> = { ...schema.shape, targetRef: browserRef };
    const scopedFields = [
        ['workflowId', 'workflowRef', 'workflow_list 或 workflow_get'],
        ['runId', 'runRef', 'workflow_run 或 run_get'],
        ['datasetId', 'datasetRef', 'dataset_list'],
    ] as const;
    if (fields.pageRef) fields.pageRef = sourceRef.describe('使用同一浏览器的 browser_context 或 page_open 返回的 pageRef。');
    for (const [oldName, newName, source] of scopedFields) {
        const field = fields[oldName];
        if (!field) continue;
        const ref = sourceRef.describe('使用同一浏览器的 ' + source + ' 返回的 ' + newName + '。');
        fields[newName] = oldName !== 'datasetId' && field.isOptional() ? ref.optional() : ref;
        delete fields[oldName];
    }
    if (fields.datasetRef) delete fields.datasetName;
    return z.strictObject(fields);
}

export function translateResources(target: RoutedTarget, method: string, params: Fields): Fields {
    const { targetRef: _targetRef, workflowRef, runRef, datasetRef, ...input } = params;
    if ('pageRef' in input) {
        const [tabId, pageRef] = readScoped(target, 'page', input.pageRef, pageValue);
        if (tabId !== input.tabId) throw new Error('RESOURCE_TARGET_MISMATCH');
        input.pageRef = pageRef;
    }
    if (workflowRef !== undefined) input.workflowId = readScoped(target, 'workflow', workflowRef, workflowValue);
    if (runRef !== undefined) input.runId = readScoped(target, 'run', runRef, runValue);
    if (datasetRef !== undefined) input.datasetId = readScoped(target, 'dataset', datasetRef, datasetValue);
    if (method === 'workflow_save') {
        const workflow = fieldsOf(input.workflow);
        if (!workflow || Object.hasOwn(workflow, 'workflowId')) throw new Error('WORKFLOW_REFERENCE_REQUIRED');
        const { workflowRef: existing, ...body } = workflow;
        input.workflow = existing === undefined ? body : { ...body, workflowId: readScoped(target, 'workflow', existing, workflowValue) };
    }
    return input;
}

export function scopeResources(target: RoutedTarget, method: string, result: unknown): unknown {
    const fields = fieldsOf(result);
    if (!fields) return result;
    const scoped: Fields = { ...fields };
    const add = <T>(kind: Kind, value: unknown, schema: ZodType<T>, name: string) => {
        const valid = schema.safeParse(value);
        if (valid.success) scoped[name] = scopedRef(target, kind, valid.data);
    };

    // Only wrap protocol fields. Dataset rows and workflow DSL may contain identically named business fields.
    if (method === 'workflow_contract') {
        const contract = fieldsOf(fields.mcp);
        if (contract && typeof contract.instructions === 'string') {
            const routerInstructions = '本通用入口以工具 Schema 为准。每次调用携带原 targetRef。' +
                '页面沿用带来源的 tabId 和 pageRef，工作流、运行和数据集使用 workflowRef、runRef 和 datasetRef。' +
                '修改已保存的工作流时，把 workflowRef 放在 workflow 对象中。回执查询沿用原 targetRef 和 requestId。' +
                '以下编排规则中的原始编号只用于说明业务数据。\n';
            scoped.mcp = { ...contract, instructions: routerInstructions + contract.instructions };
        }
    }
    if (method === 'browser_context' && Array.isArray(fields.tabs)) scoped.tabs = fields.tabs.map(tab => scopeResources(target, 'page_open', tab));
    if (method === 'page_open') add('page', [fields.tabId, fields.pageRef], pageValue, 'pageRef');
    if (method === 'workflow_list' && Array.isArray(fields.workflows)) scoped.workflows = fields.workflows.map(workflow => scopeResources(target, 'workflow_get', workflow));
    if (method === 'workflow_get') add('workflow', fields.id, workflowValue, 'workflowRef');
    if (method === 'workflow_save' || method === 'workflow_run' || method === 'run_summary') add('workflow', fields.workflowId, workflowValue, 'workflowRef');
    if (method === 'workflow_run' || method === 'run_control' || method === 'run_summary') add('run', fields.runId, runValue, 'runRef');
    if (method === 'run_get') {
        if (fields.run) scoped.run = scopeResources(target, 'run_summary', fields.run);
        if (Array.isArray(fields.runs)) scoped.runs = fields.runs.map(run => scopeResources(target, 'run_summary', run));
    }
    if (method === 'run_summary' && Array.isArray(fields.outputDatasetIds)) {
        scoped.outputDatasetRefs = fields.outputDatasetIds.filter(id => datasetValue.safeParse(id).success)
            .map(id => scopedRef(target, 'dataset', id));
    }
    if (method === 'dataset_list' && Array.isArray(fields.datasets)) scoped.datasets = fields.datasets.map(dataset => scopeResources(target, 'dataset_metadata', dataset));
    if (method === 'dataset_metadata') add('dataset', fields.id, datasetValue, 'datasetRef');
    if (method === 'dataset_read') add('dataset', fields.datasetId, datasetValue, 'datasetRef');
    if (method === 'connection_status') {
        const request = fieldsOf(fields.request);
        if (request && typeof request.method === 'string' && Object.hasOwn(request, 'result') && request.result !== undefined) {
            scoped.request = { ...request, result: scopeResources(target, request.method, request.result) };
        }
    }
    return scoped;
}
