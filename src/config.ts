import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { UserConfig } from 'vite';
import { mergeConfig, type ViteUserConfigExport } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import {
    resolveAdministration,
    resolveAdministrationPackage,
    type ResolveAdministrationOptions,
} from './discovery.js';
import { shopwareBridgePlugin, shopwareSetupSfcPlugin } from './plugins.js';

export interface ShopwareRuntimeOptions {
    /** Fail a test when it emits an unexpected console warning or error. */
    strictConsole?: boolean;
    /** Skip component discovery and Administration UI registrations for class/API tests. */
    mode?: 'full' | 'lite';
    /** Persist the Administration component import map between Vitest starts. */
    componentScanCache?: boolean;
}

export interface ShopwareVitestOptions extends ResolveAdministrationOptions {
    runtime?: ShopwareRuntimeOptions;
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

    const vueRuntime = administration.version === '6.6'
        ? resolveAdministrationPackage(administration, '@vue/compat/dist/vue.esm-bundler.js')
        : resolveAdministrationPackage(administration, 'vue');
    const aliases = {
        src: path.join(administration.path, 'src'),
        vue: vueRuntime,
        pinia: resolveAdministrationPackage(administration, 'pinia'),
        'vue-i18n': resolveAdministrationPackage(administration, 'vue-i18n'),
        'vue-router': resolveAdministrationPackage(administration, 'vue-router'),
        '@vue/test-utils': resolveAdministrationPackage(administration, '@vue/test-utils'),
    };

    const setupSfcPlugin = shopwareSetupSfcPlugin(administration);

    const baseConfig: UserConfig = {
        root: cwd,
        logLevel: 'error',
        plugins: [
            ...(setupSfcPlugin ? [setupSfcPlugin] : []),
            vue(),
            shopwareBridgePlugin(administration, options.runtime),
        ],
        resolve: {
            alias: aliases,
            dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n'],
        },
        ssr: {
            noExternal: ['@friendsofshopware/vitest-shopware-admin-bridge'],
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
    const noExternal = merged.ssr?.noExternal;
    merged.ssr = {
        ...merged.ssr,
        noExternal: noExternal === true
            ? true
            : [...new Set([
                ...toArray(noExternal),
                '@friendsofshopware/vitest-shopware-admin-bridge',
            ])],
    };

    return merged;
}
