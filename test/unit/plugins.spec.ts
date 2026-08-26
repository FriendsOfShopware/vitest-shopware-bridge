import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildComponentImportMap,
    loadComponentImportMap,
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

    it('resolves component directory imports to their index module', () => {
        const administration = mkdtempSync(path.join(tmpdir(), 'shopware-component-directory-'));
        const source = path.join(administration, 'src/app/component/index.ts');
        const componentIndex = path.join(administration, 'src/app/component/page/sw-settings-index/index.ts');
        mkdirSync(path.dirname(componentIndex), { recursive: true });
        writeFileSync(source, "Shopware.Component.register('sw-settings-index', () => import('./page/sw-settings-index'));\n");
        writeFileSync(componentIndex, 'export default {};\n');

        expect(buildComponentImportMap(administration)).toMatchObject({
            'sw-settings-index': { path: componentIndex, register: true },
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
        const storeInitializer = path.join(administration, 'src/app/init-pre/store.init.ts');
        mkdirSync(path.dirname(contextStore), { recursive: true });
        mkdirSync(path.dirname(storeInitializer), { recursive: true });
        writeFileSync(contextStore, 'export default true;');
        writeFileSync(storeInitializer, 'export default true;');

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
        expect(source).toContain(storeInitializer);
    });

    it('does not build component loaders in lite mode', async () => {
        const administration = mkdtempSync(path.join(tmpdir(), 'shopware-lite-runtime-'));
        const plugin = shopwareBridgePlugin({
            path: administration,
            version: '6.7',
            packageJsonPath: path.join(administration, 'package.json'),
            nodeModulesPath: path.join(administration, 'node_modules'),
        }, { mode: 'lite' });
        const virtualId = 'virtual:vitest-shopware-admin-bridge/component-loaders';
        const resolved = await (plugin.resolveId as Function).call({}, virtualId);

        expect((plugin.load as Function).call({}, resolved)).toBe('export default {};');
    });

    it('persists the component import map per Administration revision', () => {
        const administrationPath = mkdtempSync(path.join(tmpdir(), 'shopware-component-cache-'));
        const cacheDirectory = mkdtempSync(path.join(tmpdir(), 'shopware-component-cache-data-'));
        const source = path.join(administrationPath, 'src/app/component/index.ts');
        mkdirSync(path.dirname(source), { recursive: true });
        mkdirSync(path.join(administrationPath, '.git'), { recursive: true });
        writeFileSync(path.join(administrationPath, '.git/HEAD'), '1111111111111111111111111111111111111111\n');
        writeFileSync(source, "Shopware.Component.register('first-component', {});\n");
        const administration = {
            path: administrationPath,
            version: '6.7' as const,
            packageJsonPath: path.join(administrationPath, 'package.json'),
            nodeModulesPath: path.join(administrationPath, 'node_modules'),
        };

        expect(loadComponentImportMap(administration, { cacheDirectory })).toHaveProperty('first-component');
        writeFileSync(source, "Shopware.Component.register('second-component', {});\n");

        expect(loadComponentImportMap(administration, { cacheDirectory })).toHaveProperty('first-component');
        expect(loadComponentImportMap(administration, { cache: false })).toHaveProperty('second-component');
        expect(readdirSync(cacheDirectory)).toHaveLength(1);
    });
});
