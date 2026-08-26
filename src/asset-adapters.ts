import { existsSync, readFileSync } from 'node:fs';

export const BRIDGE_STYLE_STUB_ID = '\0vitest-shopware-admin-bridge:style';

export interface BridgeTemplateTransformResult {
    code: string;
    map: null;
}

function fileNameFromModuleId(id: string): string {
    const suffixStart = id.search(/[?#]/);
    return suffixStart === -1 ? id : id.slice(0, suffixStart);
}

export function isBridgeStyleRequest(id: string): boolean {
    return /\.(?:css|less|scss)$/.test(fileNameFromModuleId(id));
}

export function isBridgeSvgRequest(id: string): boolean {
    return /\.svg$/.test(fileNameFromModuleId(id));
}

export function isBridgeTemplateRequest(id: string): boolean {
    return /\.(?:html\.twig|twig|html)$/.test(fileNameFromModuleId(id));
}

/**
 * Canonical bridge behavior: discard comments that cannot affect the rendered
 * component and otherwise preserve the template byte-for-byte.
 */
export function transformTwigTemplate(source: string): string {
    return source
        .replaceAll(/<!--[\s\S]*?(?:-->|$)/g, '')
        .replaceAll('<!--', '')
        .replaceAll(/\{#[\s\S]*?(?:#\}|$)/g, '')
        .replaceAll('{#', '');
}

export function resolveBridgeAssetId(source: string): string | null {
    return isBridgeStyleRequest(source) ? BRIDGE_STYLE_STUB_ID : null;
}

export function loadBridgeAssetModule(id: string): string | null {
    if (id === BRIDGE_STYLE_STUB_ID) {
        return 'export default {}';
    }

    if (!isBridgeSvgRequest(id)) {
        return null;
    }

    const fileName = fileNameFromModuleId(id);
    if (!existsSync(fileName)) {
        return null;
    }

    return `export default ${JSON.stringify(readFileSync(fileName, 'utf8'))};`;
}

export function transformBridgeTemplateModule(
    source: string,
    id: string,
): BridgeTemplateTransformResult | null {
    if (!isBridgeTemplateRequest(id)) {
        return null;
    }

    return {
        code: `export default ${JSON.stringify(transformTwigTemplate(source))};`,
        map: null,
    };
}
