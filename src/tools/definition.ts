import { z, type ZodObject } from 'zod/v4';
import type { METHODS } from '../methods.ts';

export const pageTargetFields = {
    tabId: z.number().int().positive(),
    pageRef: z.string().regex(/^[0-9a-f]{64}$/).describe('原样使用同一服务的 page_open 或 browser_context 返回的页面引用。'),
};

export interface ForwardedToolDefinition {
    name: (typeof METHODS)[number];
    description: string;
    schema: ZodObject;
    readOnly: boolean;
    destructive?: boolean;
    openWorld: boolean;
}
