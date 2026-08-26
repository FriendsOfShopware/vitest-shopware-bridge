import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { createJiti } from 'jiti';
import {
    loadBridgeAssetModule,
    resolveBridgeAssetId,
    transformBridgeTemplateModule,
} from './asset-adapters.js';
import type { ShopwareRuntimeOptions } from './config.js';
import type { ResolvedAdministration } from './discovery.js';

const ADMIN_MODULES: Record<string, string> = {
    'virtual:vitest-shopware-admin-bridge/admin-core': 'src/core/shopware.ts',
    'virtual:vitest-shopware-admin-bridge/state': 'src/app/init-pre/state.init',
    'virtual:vitest-shopware-admin-bridge/component-helper': 'src/app/init/component-helper.init',
};

const REGISTRATION_MODULES: Record<string, string> = {
    'virtual:vitest-shopware-admin-bridge/mixins': 'src/app/mixin',
    'virtual:vitest-shopware-admin-bridge/directives': 'src/app/directive',
    'virtual:vitest-shopware-admin-bridge/filters': 'src/app/filter',
};

const OPTIONAL_ADMIN_MODULES: Record<string, string> = {
    'virtual:vitest-shopware-admin-bridge/virtual-call-stack-plugin': 'src/app/plugin/virtual-call-stack.plugin',
    'virtual:vitest-shopware-admin-bridge/meteor-sdk-data-plugin': 'src/app/plugin/meteor-sdk-data.plugin',
    'virtual:vitest-shopware-admin-bridge/block-data-scope':
        'src/app/component/structure/sw-block-override/sw-block/get-block-data-scope',
};

const COMPONENT_LOADERS_ID = 'virtual:vitest-shopware-admin-bridge/component-loaders';
const RUNTIME_OPTIONS_ID = 'virtual:vitest-shopware-admin-bridge/runtime-options';
const CORE_STORES_ID = 'virtual:vitest-shopware-admin-bridge/core-stores';
const EMPTY_PLUGIN_ID = '\0vitest-shopware-admin-bridge:empty-plugin';
const EMPTY_DATA_SCOPE_ID = '\0vitest-shopware-admin-bridge:empty-data-scope';
const COMPONENT_MAP_CACHE_VERSION = 1;

export interface ComponentImportInfo {
    path: string;
    register: boolean;
    extends?: string;
    extend?: boolean;
}

function sourceFiles(root: string): string[] {
    const result: string[] = [];

    function visit(directory: string): void {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                if (!['node_modules', 'test', 'tests', 'meta'].includes(entry.name) && !entry.name.endsWith('.spec')) {
                    visit(entryPath);
                }
                continue;
            }

            if (/\.(?:js|ts)$/.test(entry.name) && !/\.(?:spec|test|d)\.(?:js|ts)$/.test(entry.name)) {
                result.push(entryPath);
            }
        }
    }

    visit(root);
    return result;
}

function resolveComponentImport(administrationPath: string, sourceFile: string, specifier: string): string {
    let resolved: string;
    if (specifier === 'src') {
        resolved = path.join(administrationPath, 'src');
    } else if (specifier.startsWith('src/')) {
        resolved = path.join(administrationPath, specifier);
    } else if (specifier.startsWith('.')) {
        resolved = path.resolve(path.dirname(sourceFile), specifier);
    } else {
        return specifier;
    }

    return resolveExistingModule(resolved);
}

function resolveExistingModule(candidate: string): string {
    for (const resolved of [
        candidate,
        `${candidate}.js`,
        `${candidate}.ts`,
        path.join(candidate, 'index.js'),
        path.join(candidate, 'index.ts'),
    ]) {
        if (existsSync(resolved) && statSync(resolved).isFile()) {
            return resolved;
        }
    }
    return candidate;
}

/**
 * Builds Shopware's component-name-to-import relation without writing the
 * generated component-imports.js file into the Administration checkout.
 */
export function buildComponentImportMap(administrationPath: string): Record<string, ComponentImportInfo> {
    const map: Record<string, ComponentImportInfo> = {};
    const srcRoot = path.join(administrationPath, 'src');

    if (!existsSync(srcRoot)) {
        return map;
    }

    const importExpression = String.raw`(?:\(\s*\)\s*=>\s*)?import\(\s*['"]([^'"]+)['"]\s*\)`;
    const registerImport = new RegExp(
        String.raw`(?:Shopware\.)?Component\.register\(\s*['"]([^'"]+)['"]\s*,\s*${importExpression}`,
        'g',
    );
    const extendImport = new RegExp(
        String.raw`(?:Shopware\.)?Component\.extend\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*${importExpression}`,
        'g',
    );
    const registerCall = /(?:Shopware\.)?Component\.register\(\s*['"]([^'"]+)['"]\s*,/g;
    const extendCall = /(?:Shopware\.)?Component\.extend\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,/g;

    for (const sourceFile of sourceFiles(srcRoot)) {
        const source = readFileSync(sourceFile, 'utf8');
        let match: RegExpExecArray | null;

        while ((match = registerCall.exec(source))) {
            map[match[1]] ??= { path: sourceFile, register: false };
        }

        while ((match = extendCall.exec(source))) {
            map[match[1]] ??= { path: sourceFile, register: false, extends: match[2], extend: false };
        }

        while ((match = registerImport.exec(source))) {
            map[match[1]] = {
                path: resolveComponentImport(administrationPath, sourceFile, match[2]),
                register: true,
            };
        }

        while ((match = extendImport.exec(source))) {
            map[match[1]] = {
                path: resolveComponentImport(administrationPath, sourceFile, match[3]),
                register: false,
                extends: match[2],
                extend: true,
            };
        }
    }

    return map;
}

function findGitDirectory(startPath: string): string | null {
    let current = path.resolve(startPath);

    while (true) {
        const dotGit = path.join(current, '.git');
        if (existsSync(dotGit)) {
            if (statSync(dotGit).isDirectory()) {
                return dotGit;
            }

            const match = readFileSync(dotGit, 'utf8').trim().match(/^gitdir:\s*(.+)$/);
            if (match) {
                return path.resolve(current, match[1]);
            }
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function readGitRevision(administrationPath: string): string | null {
    const gitDirectory = findGitDirectory(administrationPath);
    if (!gitDirectory) {
        return null;
    }

    const headPath = path.join(gitDirectory, 'HEAD');
    if (!existsSync(headPath)) {
        return null;
    }

    const head = readFileSync(headPath, 'utf8').trim();
    if (/^[a-f\d]{40}$/i.test(head)) {
        return head;
    }

    const ref = head.match(/^ref:\s*(.+)$/)?.[1];
    if (!ref) {
        return head;
    }

    const roots = [gitDirectory];
    const commonDirectoryPath = path.join(gitDirectory, 'commondir');
    if (existsSync(commonDirectoryPath)) {
        roots.push(path.resolve(gitDirectory, readFileSync(commonDirectoryPath, 'utf8').trim()));
    }

    for (const root of roots) {
        const looseRef = path.join(root, ref);
        if (existsSync(looseRef)) {
            return readFileSync(looseRef, 'utf8').trim();
        }

        const packedRefs = path.join(root, 'packed-refs');
        if (existsSync(packedRefs)) {
            const match = readFileSync(packedRefs, 'utf8')
                .split('\n')
                .find((line) => line.endsWith(` ${ref}`));
            if (match) {
                return match.split(' ')[0];
            }
        }
    }

    return head;
}

function componentMapIdentity(administration: ResolvedAdministration): string {
    const packageMtime = existsSync(administration.packageJsonPath)
        ? statSync(administration.packageJsonPath).mtimeMs
        : 0;
    const revision = readGitRevision(administration.path);
    if (revision) {
        // Component loaders contain absolute source paths, so keep equal Git
        // revisions from different worktrees isolated from one another.
        return `git:${revision}:path:${path.resolve(administration.path)}:package-mtime:${packageMtime}`;
    }

    const sourceRoot = path.join(administration.path, 'src');
    const sourceMtime = existsSync(sourceRoot) ? statSync(sourceRoot).mtimeMs : 0;
    return `path:${administration.path}:version:${administration.version}:mtime:${packageMtime}:${sourceMtime}`;
}

export function loadComponentImportMap(
    administration: ResolvedAdministration,
    options: { cache?: boolean; cacheDirectory?: string } = {},
): Record<string, ComponentImportInfo> {
    if (options.cache === false) {
        return buildComponentImportMap(administration.path);
    }

    const identity = componentMapIdentity(administration);
    const cacheDirectory = options.cacheDirectory ?? path.join(
        process.env.VITEST_SHOPWARE_ADMIN_BRIDGE_CACHE_DIR ?? tmpdir(),
        'vitest-shopware-admin-bridge',
        'component-imports',
    );
    const cacheKey = createHash('sha256')
        .update(`${COMPONENT_MAP_CACHE_VERSION}:${identity}`)
        .digest('hex');
    const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);

    try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as {
            version: number;
            identity: string;
            imports: Record<string, ComponentImportInfo>;
        };
        if (cached.version === COMPONENT_MAP_CACHE_VERSION && cached.identity === identity) {
            return cached.imports;
        }
    } catch {
        // A missing or corrupt cache is equivalent to a cold start.
    }

    const imports = buildComponentImportMap(administration.path);
    try {
        mkdirSync(cacheDirectory, { recursive: true });
        const temporaryPath = `${cachePath}.${process.pid}.tmp`;
        writeFileSync(temporaryPath, JSON.stringify({
            version: COMPONENT_MAP_CACHE_VERSION,
            identity,
            imports,
        }));
        renameSync(temporaryPath, cachePath);
    } catch {
        // Cache writes are an optimization and must never block test startup.
    }

    return imports;
}

function componentLoadersModule(administration: ResolvedAdministration, cache: boolean): string {
    const entries = Object.entries(loadComponentImportMap(administration, { cache })).map(([name, info]) => {
        const importPath = info.path.startsWith('.') || path.isAbsolute(info.path)
            ? `/@fs/${info.path.replaceAll('\\', '/')}`
            : info.path;

        return `${JSON.stringify(name)}: { load: () => import(${JSON.stringify(importPath)}), register: ${
            info.register
        }, extends: ${JSON.stringify(info.extends)}, extend: ${Boolean(info.extend)} }`;
    });

    return `export default {${entries.join(',\n')}};`;
}

function coreStoresModule(administrationPath: string): string {
    const contextStore = resolveExistingModule(path.join(administrationPath, 'src/app/store/context.store'));
    if (!existsSync(contextStore)) {
        return 'export default true;';
    }

    const imports = [
        resolveExistingModule(path.join(administrationPath, 'src/app/init-pre/store.init')),
        contextStore,
    ]
        .filter((storePath) => existsSync(storePath))
        .map((storePath) => `import ${JSON.stringify(`/@fs/${storePath.replaceAll('\\', '/')}`)};`);

    return `${imports.join('\n')}\nexport default true;`;
}

function registrationModule(administrationPath: string, relativeDirectory: string): string {
    const directory = path.join(administrationPath, relativeDirectory);
    const files = sourceFiles(directory).filter((file) =>
        !(path.dirname(file) === directory && path.basename(file).startsWith('index.')));
    const imports = files.map((file) => `import(${JSON.stringify(`/@fs/${file.replaceAll('\\', '/')}`)})`);

    return `const modules = await Promise.all([${imports.join(',\n')}]);\n` +
        'export default () => modules.map((module) => module.default);';
}

export function shopwareSetupSfcPlugin(administration: ResolvedAdministration): Plugin | null {
    const transformPath = path.join(administration.path, 'build/vue-setup-transform/index.js');
    const transformSourcePath = path.join(administration.path, 'build/vue-setup-transform/index.ts');

    if (!existsSync(transformPath) && !existsSync(transformSourcePath)) {
        return null;
    }

    const requireFromAdministration = createRequire(administration.packageJsonPath);
    const jiti = createJiti(administration.packageJsonPath);
    type TransformResult = { code: string; map?: unknown } | null;
    type TransformModule = { transformShopwareSetupSfc?: (source: string, fileName: string) => TransformResult };
    let transformModule: TransformModule | null = null;

    return {
        name: 'vitest-shopware-admin-bridge:shopware-setup-sfc',
        enforce: 'pre',
        transform(source, id) {
            const fileName = id.split('?')[0];
            if (!fileName.endsWith('.vue') || fileName.replaceAll('\\', '/').includes('/node_modules/')) {
                return null;
            }

            // The Shopware transform is deliberately narrower than Vue's
            // standard <script setup> support. Avoid loading it for ordinary
            // Vue SFCs and leave those to @vitejs/plugin-vue.
            if (!source.includes('swDefinePublic') && !fileName.endsWith('.override.vue')) {
                return null;
            }

            transformModule ??= (existsSync(transformSourcePath)
                ? jiti(transformSourcePath)
                : requireFromAdministration(transformPath)) as TransformModule;
            const transform = transformModule.transformShopwareSetupSfc;
            if (typeof transform !== 'function') {
                return null;
            }

            const result = transform(source, fileName);
            return result ? { code: result.code, map: (result.map ?? null) as any } : null;
        },
    };
}

export function shopwareBridgePlugin(
    administration: ResolvedAdministration,
    runtimeOptions: ShopwareRuntimeOptions = {},
): Plugin {
    return {
        name: 'vitest-shopware-admin-bridge',
        enforce: 'pre',

        resolveId(source) {
            if (source in ADMIN_MODULES) {
                return resolveExistingModule(path.join(administration.path, ADMIN_MODULES[source]));
            }

            if (source in OPTIONAL_ADMIN_MODULES) {
                const candidate = path.join(administration.path, OPTIONAL_ADMIN_MODULES[source]);
                const resolved = resolveExistingModule(candidate);
                if (existsSync(resolved)) {
                    return resolved;
                }
                return source === 'virtual:vitest-shopware-admin-bridge/block-data-scope'
                    ? EMPTY_DATA_SCOPE_ID
                    : EMPTY_PLUGIN_ID;
            }

            if (source in REGISTRATION_MODULES) {
                return `\0${source}`;
            }

            if (source === COMPONENT_LOADERS_ID || source === RUNTIME_OPTIONS_ID || source === CORE_STORES_ID) {
                return `\0${source}`;
            }

            const assetId = resolveBridgeAssetId(source);
            if (assetId) {
                return assetId;
            }

            return null;
        },

        load(id) {
            const assetModule = loadBridgeAssetModule(id);
            if (assetModule !== null) {
                return assetModule;
            }

            if (id === EMPTY_PLUGIN_ID) {
                return 'export default { install() {} };';
            }

            if (id === EMPTY_DATA_SCOPE_ID) {
                return 'export default () => ({});';
            }

            if (id === `\0${COMPONENT_LOADERS_ID}`) {
                if (runtimeOptions.mode === 'lite') {
                    return 'export default {};';
                }
                return componentLoadersModule(administration, runtimeOptions.componentScanCache !== false);
            }

            if (id === `\0${CORE_STORES_ID}`) {
                return coreStoresModule(administration.path);
            }

            const registrationSource = id.startsWith('\0') ? id.slice(1) : '';
            if (registrationSource in REGISTRATION_MODULES) {
                return registrationModule(administration.path, REGISTRATION_MODULES[registrationSource]);
            }

            if (id === `\0${RUNTIME_OPTIONS_ID}`) {
                return `export default ${JSON.stringify({
                    strictConsole: runtimeOptions.strictConsole === true,
                    mode: runtimeOptions.mode ?? 'full',
                })};`;
            }

            return null;
        },

        transform(source, id) {
            return transformBridgeTemplateModule(source, id);
        },
    };
}
