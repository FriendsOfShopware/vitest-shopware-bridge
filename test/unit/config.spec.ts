import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineShopwareConfig } from '../../src/config.js';

function createAdministration(): string {
    const administrationPath = mkdtempSync(path.join(tmpdir(), 'shopware-config-'));
    writeFileSync(path.join(administrationPath, 'package.json'), JSON.stringify({
        name: 'administration',
        dependencies: { vite: '6.4.3' },
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

    for (const packageName of ['vue', 'pinia', '@vue/test-utils', 'twig']) {
        const packageDirectory = path.join(administrationPath, 'node_modules', packageName);
        mkdirSync(packageDirectory, { recursive: true });
        writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
            name: packageName,
            version: '1.0.0',
            main: 'index.js',
        }));
        writeFileSync(path.join(packageDirectory, 'index.js'), 'module.exports = {};');
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
        expect(config.test.include).toEqual(['custom/**/*.spec.ts']);
        expect(config.test.setupFiles[0]).toMatch(/setup\.(?:js|ts)$/);
        expect(config.test.setupFiles[1]).toBe(consumerSetup);
        expect(config.resolve.alias).toMatchObject({
            src: expect.stringContaining('/src'),
            vue: expect.stringContaining('/node_modules/vue/'),
        });
    });
});

