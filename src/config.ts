import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { UserConfig } from 'vite';
import { mergeConfig, type ViteUserConfigExport } from 'vitest/config';
import {
    resolveAdministration,
    resolveAdministrationPackage,
    type ResolveAdministrationOptions,
} from './discovery.js';
import { shopwareBridgePlugin } from './plugins.js';

export interface ShopwareVitestOptions extends ResolveAdministrationOptions {
    vitest?: UserConfig;
}

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

export function defineShopwareConfig(options: ShopwareVitestOptions = {}): ViteUserConfigExport {
    const consumerConfig = options.vitest ?? {};
    const configuredRoot = typeof consumerConfig.root === 'string' ? consumerConfig.root : undefined;
    const cwd = path.resolve(options.cwd ?? configuredRoot ?? process.cwd());
    const administration = resolveAdministration({ ...options, cwd });
    const compiledSetupFile = fileURLToPath(new URL('./setup.js', import.meta.url));
    const setupFile = existsSync(compiledSetupFile)
        ? compiledSetupFile
        : fileURLToPath(new URL('./setup.ts', import.meta.url));

    process.env.VITEST_SHOPWARE_ADMINISTRATION_PATH = administration.path;
    process.env.VITEST_SHOPWARE_VERSION = administration.version;

    const aliases = {
        src: path.join(administration.path, 'src'),
        vue: resolveAdministrationPackage(administration, 'vue'),
        pinia: resolveAdministrationPackage(administration, 'pinia'),
        '@vue/test-utils': resolveAdministrationPackage(administration, '@vue/test-utils'),
    };

    const baseConfig: UserConfig = {
        root: cwd,
        logLevel: 'error',
        plugins: [shopwareBridgePlugin(administration)],
        resolve: {
            alias: aliases,
            dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'],
        },
        server: {
            fs: {
                allow: [cwd, administration.path],
            },
        },
        test: {
            clearMocks: true,
            restoreMocks: true,
            environment: 'jsdom',
            exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
            include: [
                'src/**/*.{spec,test}.{js,ts}',
                'test/**/*.{spec,test}.{js,ts}',
            ],
            setupFiles: [setupFile],
        },
    };

    const merged = mergeConfig(baseConfig, consumerConfig) as UserConfig;
    const consumerSetupFiles = toArray(consumerConfig.test?.setupFiles);

    merged.test = {
        ...merged.test,
        environment: 'jsdom',
        ...(consumerConfig.test?.include ? { include: consumerConfig.test.include } : {}),
        setupFiles: [setupFile, ...consumerSetupFiles],
    };
    merged.resolve = {
        ...merged.resolve,
        alias: {
            ...(typeof consumerConfig.resolve?.alias === 'object' && !Array.isArray(consumerConfig.resolve.alias)
                ? consumerConfig.resolve.alias
                : {}),
            ...aliases,
        },
        dedupe: [...new Set([...toArray(consumerConfig.resolve?.dedupe), 'vue', 'pinia', 'vue-router', 'vue-i18n'])],
    };
    merged.server = {
        ...merged.server,
        fs: {
            ...merged.server?.fs,
            allow: [...new Set([...toArray(consumerConfig.server?.fs?.allow), cwd, administration.path])],
        },
    };

    return merged;
}
