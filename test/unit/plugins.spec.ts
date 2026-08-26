import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildComponentImportMap,
    shopwareBridgePlugin,
    shopwareSetupSfcPlugin,
} from '../../src/plugins.js';

describe('Shopware integration plugins', () => {
    it('discovers sync, async and extended Administration components without writing a map', () => {
        const administration = mkdtempSync(path.join(tmpdir(), 'shopware-component-map-'));
        const source = path.join(administration, 'src/app/component/index.ts');
        mkdirSync(path.dirname(source), { recursive: true });
        writeFileSync(source, [
            "Shopware.Component.register('sync-component', { template: '<div />' });",
            "Shopware.Component.register('async-component', () => import('./async-component'));",
            "Shopware.Component.extend('extended-component', 'async-component', () => import('./extended-component'));",
        ].join('\n'));

        expect(buildComponentImportMap(administration)).toMatchObject({
            'sync-component': { path: source, register: false },
            'async-component': {
                path: path.join(path.dirname(source), 'async-component'),
                register: true,
            },
            'extended-component': {
                path: path.join(path.dirname(source), 'extended-component'),
                extends: 'async-component',
                extend: true,
            },
        });
    });

    it('delegates native setup SFCs to the transform shipped by the Administration', async () => {
        const administration = mkdtempSync(path.join(tmpdir(), 'shopware-setup-sfc-'));
        const transformFile = path.join(administration, 'build/vue-setup-transform/index.js');
        mkdirSync(path.dirname(transformFile), { recursive: true });
        writeFileSync(path.join(administration, 'package.json'), '{"name":"administration"}');
        writeFileSync(
            transformFile,
            "module.exports = { transformShopwareSetupSfc(source) { return { code: source + '\\n<!-- transformed -->' }; } };",
        );
        const plugin = shopwareSetupSfcPlugin({
            path: administration,
            version: '6.7',
            packageJsonPath: path.join(administration, 'package.json'),
            nodeModulesPath: path.join(administration, 'node_modules'),
        });

        expect(plugin).not.toBeNull();
        const transform = plugin!.transform as Function;
        const result = await transform.call(
            {},
            '<template><div /></template><script setup>swDefinePublic({});</script>',
            '/extension/component.vue',
        );
        expect(result.code).toContain('transformed');
    });

    it('generates a core-store bootstrap from the modules present in the Administration version', async () => {
        const administration = mkdtempSync(path.join(tmpdir(), 'shopware-core-stores-'));
        const contextStore = path.join(administration, 'src/app/store/context.store.ts');
        const systemStore = path.join(administration, 'src/app/store/system.store.js');
        mkdirSync(path.dirname(contextStore), { recursive: true });
        writeFileSync(contextStore, 'export default true;');
        writeFileSync(systemStore, 'export default true;');

        const plugin = shopwareBridgePlugin({
            path: administration,
            version: '6.7',
            packageJsonPath: path.join(administration, 'package.json'),
            nodeModulesPath: path.join(administration, 'node_modules'),
        });
        const virtualId = 'virtual:vitest-shopware-admin-bridge/core-stores';
        const resolved = await (plugin.resolveId as Function).call({}, virtualId);
        const source = await (plugin.load as Function).call({}, resolved);

        expect(source).toContain(contextStore);
        expect(source).toContain(systemStore);
        expect(source).not.toContain('session.store');
    });
});
