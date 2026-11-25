import type { BrowserKind } from './native-host-registry.ts';

export interface BrowserTarget { kind: BrowserKind; extensionId: string }
export type BrowserBrand = 'chrome' | 'edge' | 'firefox';

export function browserBrand(value: unknown): value is BrowserBrand {
    return value === 'chrome' || value === 'edge' || value === 'firefox';
}

export function checkExtensionId(kind: BrowserKind, id: string): void {
    const valid = kind === 'chrome' ? /^[a-p]{32}$/ : /^[a-zA-Z0-9@._{}-]{1,128}$/;
    if (!valid.test(id)) throw new Error(kind === 'chrome' ? 'Invalid Chrome extension ID' : 'Invalid Firefox extension ID');
}

export function sameExtension(left: BrowserTarget, right?: BrowserTarget): boolean {
    return left.kind === right?.kind && left.extensionId === right.extensionId;
}

// Chrome 传调用者的 origin，Firefox 依次传宿主清单路径和扩展 ID。
export function nativeCaller(args: string[]): BrowserTarget {
    const chrome = /^chrome-extension:\/\/([a-p]{32})\/?$/.exec(args[0] ?? '');
    if (chrome) return { kind: 'chrome', extensionId: chrome[1] };
    if (args[0]?.toLowerCase().endsWith('.json') && args[1]) {
        checkExtensionId('firefox', args[1]);
        return { kind: 'firefox', extensionId: args[1] };
    }
    throw new Error('NATIVE_CALLER_UNKNOWN');
}
