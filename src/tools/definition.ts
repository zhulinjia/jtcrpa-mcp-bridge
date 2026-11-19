import type { ZodObject } from 'zod/v4';
import type { METHODS } from '../methods.ts';

export interface ForwardedToolDefinition {
    name: (typeof METHODS)[number];
    description: string;
    schema: ZodObject;
    readOnly: boolean;
    openWorld: boolean;
}
