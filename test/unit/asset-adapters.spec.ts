import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    BRIDGE_STYLE_STUB_ID,
    isBridgeStyleRequest,
    isBridgeSvgRequest,
    isBridgeTemplateRequest,
    loadBridgeAssetModule,
    resolveBridgeAssetId,
    transformBridgeTemplateModule,
    transformTwigTemplate,
} from '../../src/asset-adapters.js';

describe('bridge-owned asset adapters', () => {
    it('recognises supported assets independently of Vite query and hash suffixes', () => {
        expect(isBridgeTemplateRequest('/component.html.twig?direct')).toBe(true);
        expect(isBridgeTemplateRequest('/fixture.html#fragment')).toBe(true);
        expect(isBridgeSvgRequest('/icon.svg?raw')).toBe(true);
        expect(isBridgeStyleRequest('/component.scss?inline')).toBe(true);
        expect(isBridgeTemplateRequest('/component.vue')).toBe(false);
    });

    it('removes closed and unclosed comments while preserving all other template bytes', () => {
        const source = '<!-- html -->\r\n{# twig #}\r\n<div data-path="C:\\tmp">$value "quoted"</div>\r\n';
        const expected = '\r\n\r\n<div data-path="C:\\tmp">$value "quoted"</div>\r\n';

        expect(transformTwigTemplate(source)).toBe(expected);
        expect(transformTwigTemplate('visible<!-- unclosed')).toBe('visible');
        expect(transformTwigTemplate('visible{# unclosed')).toBe('visible');
    });

    it('emits a safely escaped ESM template string with canonical bridge behavior', () => {
        const source = '<!-- remove --><div title="quoted">C:\\tmp $value</div>';
        const expected = '<div title="quoted">C:\\tmp $value</div>';

        expect(transformBridgeTemplateModule(source, '/component.html.twig?direct')).toEqual({
            code: `export default ${JSON.stringify(expected)};`,
            map: null,
        });
        expect(transformBridgeTemplateModule(source, '/component.vue')).toBeNull();
    });

    it('loads SVG files as exact UTF-8 ESM strings', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'shopware-svg-adapter-'));
        const svgPath = path.join(directory, 'icon.svg');
        const source = '<svg viewBox="0 0 1 1">\r\n  <path d="M0 0" />\r\n</svg>\r\n';
        writeFileSync(svgPath, source);

        expect(loadBridgeAssetModule(`${svgPath}?raw`)).toBe(`export default ${JSON.stringify(source)};`);
        expect(loadBridgeAssetModule(path.join(directory, 'missing.svg'))).toBeNull();
    });

    it('maps supported styles to a stable empty module', () => {
        expect(resolveBridgeAssetId('/component.less?inline')).toBe(BRIDGE_STYLE_STUB_ID);
        expect(loadBridgeAssetModule(BRIDGE_STYLE_STUB_ID)).toBe('export default {}');
        expect(resolveBridgeAssetId('/component.ts')).toBeNull();
    });
});
