import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAdministration, ShopwareBridgeError } from '../../src/discovery.js';

function createAdministration(
    version: '6.6' | '6.7',
    withDependencies = true,
    target?: string,
): string {
    const administrationPath = target ?? mkdtempSync(path.join(tmpdir(), `shopware-${version}-`));
    const dependencies = version === '6.7' ? { vite: '6.4.3' } : { webpack: '5.97.1' };

    mkdirSync(administrationPath, { recursive: true });
    writeFileSync(path.join(administrationPath, 'package.json'), JSON.stringify({ name: 'administration', dependencies }));

    for (const sourceFile of [
        'src/core/shopware.ts',
        'src/app/init-pre/state.init.ts',
        'src/app/init/component-helper.init.ts',
    ]) {
        const file = path.join(administrationPath, sourceFile);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'export default {};');
    }

    if (withDependencies) {
        for (const packageName of ['vue', 'pinia', '@vue/test-utils', 'twig']) {
            const packageFile = path.join(administrationPath, 'node_modules', packageName, 'package.json');
            mkdirSync(path.dirname(packageFile), { recursive: true });
            writeFileSync(packageFile, JSON.stringify({ name: packageName, version: '1.0.0', main: 'index.js' }));
            writeFileSync(path.join(path.dirname(packageFile), 'index.js'), 'module.exports = {};');
        }
    }

    return administrationPath;
}

describe('resolveAdministration', () => {
    it.each(['6.6', '6.7'] as const)('detects Shopware %s from its frontend manifest', (version) => {
        const administrationPath = createAdministration(version);

        expect(resolveAdministration({ administrationPath })).toMatchObject({
            path: realpathSync(administrationPath),
            version,
        });
    });

    it('finds a Composer-installed Administration while walking upwards', () => {
        const project = mkdtempSync(path.join(tmpdir(), 'shopware-project-'));
        const administrationPath = path.join(
            project,
            'vendor/shopware/administration/Resources/app/administration',
        );
        createAdministration('6.7', true, administrationPath);
        const nested = path.join(project, 'custom/plugins/Example/src/Resources/app/administration');
        mkdirSync(nested, { recursive: true });

        const resolved = resolveAdministration({ cwd: nested });

        expect(resolved.path).toBe(realpathSync(administrationPath));
    });

    it('reports an actionable command when Administration dependencies are absent', () => {
        const administrationPath = createAdministration('6.7', false);

        expect(() => resolveAdministration({ administrationPath })).toThrowError(
            expect.objectContaining<Partial<ShopwareBridgeError>>({
                code: 'ADMINISTRATION_DEPENDENCIES_MISSING',
                details: expect.objectContaining({
                    administrationPath: realpathSync(administrationPath),
                    installCommand: expect.stringContaining('npm ci --prefix'),
                }),
            }),
        );
    });

    it('lists attempted paths when no Administration exists', () => {
        const cwd = mkdtempSync(path.join(tmpdir(), 'shopware-missing-'));

        expect(() => resolveAdministration({ cwd })).toThrowError(
            expect.objectContaining<Partial<ShopwareBridgeError>>({
                code: 'ADMINISTRATION_NOT_FOUND',
                details: expect.objectContaining({ attemptedPaths: expect.any(Array) }),
            }),
        );
    });
});
