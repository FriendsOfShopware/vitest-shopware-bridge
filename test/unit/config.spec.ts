import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineShopwareConfig } from '../../src/config.js';

function createAdministration(version: '6.6' | '6.7' = '6.7'): string {
    const administrationPath = mkdtempSync(path.join(tmpdir(), 'shopware-config-'));
    writeFileSync(path.join(administrationPath, 'package.json'), JSON.stringify({
        name: 'administration',
        dependencies: version === '6.6'
            ? { vite: '5.4.0', webpack: '5.97.1', '@vue/compat': '3.4.0' }
            : { vite: '6.4.3' },
    }));

    for (const sourceFile of [
        'src/core/shopware.ts',
        'src/app/init-pre/state.init.ts',
        'src/app/init/component-helper.init.ts',
    ]) {
        const file = path.join(administrationPath, sourceFile);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'export default {};');
    }

    for (const packageName of [
        'vue',
        'pinia',
        'vue-i18n',
        'vue-router',
        '@vue/test-utils',
        'twig',
        ...(version === '6.6' ? ['@vue/compat'] : []),
    ]) {
        const packageDirectory = path.join(administrationPath, 'node_modules', packageName);
        mkdirSync(packageDirectory, { recursive: true });
        writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
            name: packageName,
            version: '1.0.0',
            main: 'index.js',
        }));
        writeFileSync(path.join(packageDirectory, 'index.js'), 'module.exports = {};');
        if (packageName === '@vue/compat') {
            mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
            writeFileSync(path.join(packageDirectory, 'dist/vue.esm-bundler.js'), 'export default {};');
        }
    }

    return administrationPath;
}

describe('defineShopwareConfig', () => {
    it('keeps bridge setup mandatory while honoring consumer test selection', () => {
        const administrationPath = createAdministration();
        const consumerSetup = path.join(administrationPath, 'consumer-setup.ts');
        const config = defineShopwareConfig({
            administrationPath,
            vitest: {
                test: {
                    environment: 'node',
                    include: ['custom/**/*.spec.ts'],
                    setupFiles: [consumerSetup],
                },
            },
        }) as any;

        expect(config.test.environment).toBe('jsdom');
        expect(config.test.clearMocks).toBe(true);
        expect(config.test.restoreMocks).toBe(true);
        expect(config.test.include).toEqual(['custom/**/*.spec.ts']);
        expect(config.test.setupFiles[0]).toMatch(/setup\.(?:js|ts)$/);
        expect(config.test.setupFiles[1]).toBe(consumerSetup);
        expect(config.resolve.alias).toMatchObject({
            src: expect.stringContaining('/src'),
            vue: expect.stringContaining('/node_modules/vue/'),
        });
        expect(config.ssr.noExternal).toContain('@friendsofshopware/vitest-shopware-admin-bridge');
    });

    it('uses the Vue compatibility runtime for Shopware 6.6', () => {
        const administrationPath = createAdministration('6.6');
        const config = defineShopwareConfig({ administrationPath }) as any;

        expect(config.resolve.alias.vue).toContain('/node_modules/@vue/compat/');
        expect(config.plugins.map((plugin: { name: string }) => plugin.name)).toEqual(
            expect.arrayContaining(['vite:vue', 'vitest-shopware-admin-bridge']),
        );
    });
});
