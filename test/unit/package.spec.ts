import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('published package metadata', () => {
    it('ships modules imported by the runtime setup as production dependencies', () => {
        const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
            dependencies?: Record<string, string>;
        };

        expect(packageJson.dependencies).toMatchObject({
            pinia: expect.any(String),
            'vue-i18n': expect.any(String),
        });
    });
});
