import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export type SupportedShopwareVersion = '6.6' | '6.7';

export interface ResolveAdministrationOptions {
    administrationPath?: string;
    cwd?: string;
}

export interface ResolvedAdministration {
    path: string;
    version: SupportedShopwareVersion;
    packageJsonPath: string;
    nodeModulesPath: string;
}

export type ShopwareBridgeErrorCode =
    | 'ADMINISTRATION_NOT_FOUND'
    | 'ADMINISTRATION_UNSUPPORTED'
    | 'ADMINISTRATION_DEPENDENCIES_MISSING';

export class ShopwareBridgeError extends Error {
    readonly code: ShopwareBridgeErrorCode;
    readonly details: Record<string, unknown>;

    constructor(code: ShopwareBridgeErrorCode, message: string, details: Record<string, unknown> = {}) {
        super(message);
        this.name = 'ShopwareBridgeError';
        this.code = code;
        this.details = details;
    }
}

interface AdministrationPackageJson {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

const REQUIRED_SOURCE_FILES = [
    'src/core/shopware.ts',
    'src/app/init-pre/state.init.ts',
    'src/app/init/component-helper.init.ts',
];

const REQUIRED_PACKAGES = [
    'vue',
    'pinia',
    'vue-i18n',
    'vue-router',
    '@vue/test-utils',
    'twig',
];

function isAdministrationRoot(candidate: string): boolean {
    return existsSync(path.join(candidate, 'package.json'))
        && REQUIRED_SOURCE_FILES.every((file) => existsSync(path.join(candidate, file)));
}

function expandCandidate(candidate: string): string[] {
    const absolute = path.resolve(candidate);

    return [
        absolute,
        path.join(absolute, 'Resources/app/administration'),
        path.join(absolute, 'src/Administration/Resources/app/administration'),
        path.join(absolute, 'vendor/shopware/administration/Resources/app/administration'),
    ];
}

function detectVersion(packageJson: AdministrationPackageJson): SupportedShopwareVersion | null {
    // Shopware 6.6 ships both webpack and an experimental Vite build. The
    // Vue compatibility package is the reliable boundary between 6.6 and the
    // native Vue 3 Administration introduced with 6.7.
    if (packageJson.dependencies?.['@vue/compat'] || packageJson.devDependencies?.['@vue/compat']) {
        return '6.6';
    }

    if (packageJson.dependencies?.vite) {
        return '6.7';
    }

    if (packageJson.dependencies?.webpack) {
        return '6.6';
    }

    return null;
}

function findLinkedAdministration(cwd: string): string | null {
    try {
        const require = createRequire(path.join(cwd, '__vitest-shopware-bridge__.js'));
        return path.dirname(require.resolve('administration/package.json'));
    } catch {
        return null;
    }
}

function collectCandidates(options: ResolveAdministrationOptions): string[] {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const candidates: string[] = [];

    const explicitCandidates = [
        options.administrationPath,
        process.env.SHOPWARE_ADMINISTRATION_PATH,
        process.env.ADMIN_PATH,
    ].filter((candidate): candidate is string => Boolean(candidate));

    explicitCandidates.forEach((candidate) => candidates.push(...expandCandidate(candidate)));

    const linked = findLinkedAdministration(cwd);
    if (linked) {
        candidates.push(linked);
    }

    let current = cwd;
    while (true) {
        candidates.push(path.join(current, 'src/Administration/Resources/app/administration'));
        candidates.push(path.join(current, 'vendor/shopware/administration/Resources/app/administration'));

        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }

        current = parent;
    }

    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function missingPackages(administrationPath: string, version: SupportedShopwareVersion): string[] {
    const require = createRequire(path.join(administrationPath, 'package.json'));
    const packages = version === '6.6' ? [...REQUIRED_PACKAGES, '@vue/compat'] : REQUIRED_PACKAGES;

    return packages.filter((packageName) => {
        try {
            require.resolve(`${packageName}/package.json`);
            return false;
        } catch {
            return true;
        }
    });
}

export function resolveAdministration(options: ResolveAdministrationOptions = {}): ResolvedAdministration {
    const candidates = collectCandidates(options);
    const found = candidates.find(isAdministrationRoot);

    if (!found) {
        throw new ShopwareBridgeError(
            'ADMINISTRATION_NOT_FOUND',
            'Could not find a Shopware Administration source tree.',
            { attemptedPaths: candidates },
        );
    }

    const administrationPath = realpathSync(found);
    const packageJsonPath = path.join(administrationPath, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as AdministrationPackageJson;
    const version = detectVersion(packageJson);

    if (!version) {
        throw new ShopwareBridgeError(
            'ADMINISTRATION_UNSUPPORTED',
            'The detected Administration is not a supported Shopware 6.6 or 6.7 source tree.',
            { administrationPath, packageJsonPath },
        );
    }

    const missing = missingPackages(administrationPath, version);
    if (missing.length > 0) {
        throw new ShopwareBridgeError(
            'ADMINISTRATION_DEPENDENCIES_MISSING',
            `The Shopware Administration dependencies are missing: ${missing.join(', ')}.`,
            {
                administrationPath,
                missingPackages: missing,
                installCommand: `npm ci --prefix ${JSON.stringify(administrationPath)}`,
            },
        );
    }

    return {
        path: administrationPath,
        version,
        packageJsonPath,
        nodeModulesPath: path.join(administrationPath, 'node_modules'),
    };
}

export function resolveAdministrationPackage(
    administration: ResolvedAdministration,
    packageName: string,
): string {
    const require = createRequire(administration.packageJsonPath);
    return require.resolve(packageName);
}
