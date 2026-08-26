import { afterEach, beforeEach, vi, type Mock } from 'vitest';
import { createApp } from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { config, enableAutoUnmount } from '@vue/test-utils';
import componentLoaders from 'virtual:vitest-shopware-admin-bridge/component-loaders';
import runtimeOptions from 'virtual:vitest-shopware-admin-bridge/runtime-options';
import { createConsoleGuard, type ConsoleMessagePattern, type GuardedConsoleMethod } from './console.js';

type ServiceMock = Record<string, Mock>;

export interface ShopwareTestServices {
    acl: ServiceMock;
    feature: ServiceMock;
    repositoryFactory: ServiceMock;
    userConfigService: ServiceMock;
}

export interface ShopwareTestContext {
    api?: Record<string, unknown>;
    session?: {
        locales?: string[];
        locale?: string;
        languageId?: string;
    };
}

export interface ShopwareBridgeRuntime {
    services: ShopwareTestServices;
    loadComponent(componentName: string): Promise<void>;
    prepareMount(): void;
    mockService<T>(name: string, implementation: T): () => void;
    reset(): void;
    setAclRoles(roles: readonly string[] | null): void;
    setFeatureFlags(flags: readonly string[]): void;
    setContext(context: ShopwareTestContext): void;
    allowConsole(pattern: ConsoleMessagePattern, method?: GuardedConsoleMethod | 'both'): void;
}

declare global {
    // The exact type is supplied by an extension's Administration typings.
    // eslint-disable-next-line no-var
    var Shopware: any;
}

export const RUNTIME_SYMBOL = Symbol.for('vitest-shopware-admin-bridge.runtime');
const shopwareVersion = process.env.VITEST_SHOPWARE_VERSION;
const buildFeatureFlags: Record<string, boolean> = shopwareVersion === '6.6' ? { ADMIN_VITE: true } : {};

Object.assign(globalThis, {
    _features_: buildFeatureFlags,
    startApplication: () => {},
});
Object.assign(window, {
    _features_: (globalThis as any)._features_,
    startApplication: (globalThis as any).startApplication,
});
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: window.localStorage,
});

if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {};
}
if (typeof window.matchMedia === 'undefined') {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

const { ShopwareInstance } = await import('virtual:vitest-shopware-admin-bridge/admin-core');
globalThis.Shopware = ShopwareInstance;
(window as any).Shopware = ShopwareInstance;

let currentPinia: Pinia | null = ShopwareInstance.Store?._rootState ?? null;
if (currentPinia) {
    createApp({}).use(currentPinia);
    setActivePinia(currentPinia);
}

await import('virtual:vitest-shopware-admin-bridge/core-stores');

if (ShopwareInstance.Store?.list().includes('context') && !ShopwareInstance.Store.list().includes('notification')) {
    ShopwareInstance.Store.register({
        id: 'notification',
        state: () => ({
            notifications: {},
            growlNotifications: {},
            threshold: 5,
            workerProcessPollInterval: 0,
            transformers: {},
        }),
        actions: {
            setThreshold: () => undefined,
            setNotifications: () => undefined,
            upsertNotification: () => undefined,
            setAllNotificationsVisited: () => undefined,
            upsertGrowlNotification: () => undefined,
            createNotification: () => null,
            createGrowlNotification: () => null,
            updateNotification: () => null,
            removeNotification: () => null,
            removeGrowlNotification: () => null,
            registerTransformer: () => undefined,
            clearNotificationsForCurrentUser: () => undefined,
            clearGrowlNotificationsForCurrentUser: () => undefined,
        },
    });
}

const administrationModules = runtimeOptions.mode === 'lite'
    ? ['virtual:vitest-shopware-admin-bridge/state']
    : [
        'virtual:vitest-shopware-admin-bridge/mixins',
        'virtual:vitest-shopware-admin-bridge/directives',
        'virtual:vitest-shopware-admin-bridge/filters',
        'virtual:vitest-shopware-admin-bridge/state',
        'virtual:vitest-shopware-admin-bridge/component-helper',
    ];

for (const moduleName of administrationModules) {
    const module = await import(moduleName);
    if (typeof module.default === 'function') {
        module.default();
    }
}

const services: ShopwareTestServices = {
    acl: { can: vi.fn() },
    feature: { isActive: vi.fn() },
    repositoryFactory: { create: vi.fn() },
    userConfigService: { search: vi.fn(), upsert: vi.fn() },
};
let aclRoles: Set<string> | null = null;
let activeFeatureFlags = new Set<string>();

function resetServiceDefaults(): void {
    aclRoles = null;
    activeFeatureFlags = new Set();
    services.acl.can.mockReset().mockImplementation((privilege?: string) =>
        !privilege || aclRoles === null || aclRoles.has(privilege));
    services.feature.isActive.mockReset().mockImplementation((flag: string) => activeFeatureFlags.has(flag));
    services.repositoryFactory.create.mockReset().mockImplementation(() => ({
        create: vi.fn(() => ({})),
        get: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    }));
    services.userConfigService.search.mockReset().mockResolvedValue({ data: {} });
    services.userConfigService.upsert.mockReset().mockResolvedValue(undefined);
}

function registerDefaultServices(): void {
    bindService('acl', services.acl);
    bindService('feature', services.feature);
    bindService('repositoryFactory', services.repositoryFactory);
    bindService('userConfigService', services.userConfigService);
    ShopwareInstance.Feature = services.feature;
}

function serviceBottle(): any | null {
    return ShopwareInstance.Application.$container.nested.service ?? null;
}

function removeServiceBinding(name: string): void {
    const bottle = serviceBottle();
    if (!bottle) return;
    Reflect.deleteProperty(bottle.container, name);
    Reflect.deleteProperty(bottle.container, `${name}Provider`);
    Reflect.deleteProperty(bottle.providerMap, name);
    Reflect.deleteProperty(bottle.originalProviders, name);
}

function bindService<T>(name: string, implementation: T): void {
    let bottle = serviceBottle();
    if (!bottle) {
        ShopwareInstance.Service().register(name, () => implementation);
        return;
    }
    removeServiceBinding(name);
    bottle = serviceBottle();
    bottle.factory(name, () => implementation);
}

resetServiceDefaults();
registerDefaultServices();

const DEFAULT_API_CONTEXT = {
    installationPath: '',
    apiPath: '/api',
    apiResourcePath: '/api/v3',
    assetsPath: '',
    languageId: '2fbb5fe2e29a4d70aa5854ce7ce3e20b',
    systemLanguageId: '2fbb5fe2e29a4d70aa5854ce7ce3e20b',
    liveVersionId: '0fa91ce3e96a4bc2be4bd9ce752c3425',
    inheritance: false,
};
const DEFAULT_SESSION_CONTEXT = {
    locales: ['en-GB', 'de-DE'],
    locale: 'en-GB',
    languageId: DEFAULT_API_CONTEXT.languageId,
};

function getStore(name: string): any | null {
    try {
        return ShopwareInstance.Store?.get(name) ?? null;
    } catch {
        return null;
    }
}

function getLegacyState(name: string): any | null {
    try {
        return ShopwareInstance.State?.get(name) ?? null;
    } catch {
        return null;
    }
}

function replaceLocales(store: any | null, locales: string[]): void {
    if (!Array.isArray(store?.locales)) {
        return;
    }

    store.locales.splice(0, store.locales.length, ...locales);
}

function applyContext(context: ShopwareTestContext = {}): void {
    const api = { ...DEFAULT_API_CONTEXT, ...(context.api ?? {}) };
    if (ShopwareInstance.Context?.api) {
        Object.assign(ShopwareInstance.Context.api, api);
    }
    const contextStore = getStore('context');
    if (contextStore?.api) {
        Object.assign(contextStore.api, api);
    }

    const legacyContext = getLegacyState('context');
    if (legacyContext?.api) {
        Object.assign(legacyContext.api, api);
    }

    const session = { ...DEFAULT_SESSION_CONTEXT, ...(context.session ?? {}) };
    session.locales = [...new Set(session.locales)];
    replaceLocales(getStore('system'), session.locales);
    replaceLocales(getLegacyState('system'), session.locales);

    const sessionStore = getStore('session');
    if (typeof sessionStore?.setAdminLocaleState === 'function') {
        sessionStore.setAdminLocaleState(session);
    } else if (sessionStore) {
        Object.assign(sessionStore, session);
    }

    const legacySession = getLegacyState('session');
    if (legacySession) {
        legacySession.currentLocale = session.locale;
        legacySession.languageId = session.languageId;
    }

    syncLocaleState(session);
}

ShopwareInstance.Application.view = {
    setReactive: (target: Record<string, unknown>, propertyName: string, value: unknown) =>
        (target[propertyName] = value),
    deleteReactive(target: Record<string, unknown>, propertyName: string) {
        delete target[propertyName];
    },
    root: { $t: (value: string) => value },
    i18n: {
        global: {
            tc: (value: string) => value,
            te: () => true,
            t: (value: string) => value,
        },
    },
};
if (ShopwareInstance.Telemetry) {
    ShopwareInstance.Telemetry.initialize = () => Promise.resolve();
    ShopwareInstance.Telemetry.track = () => {};
}

const routerMock = {
    replace: vi.fn(),
    push: vi.fn(),
    go: vi.fn(),
    resolve: vi.fn(() => ({ matched: [] })),
};
const deviceMock = {
    onResize: vi.fn(),
    removeResizeListener: vi.fn(),
    getSystemKey: vi.fn(() => 'CTRL'),
    getViewportWidth: vi.fn(() => 1920),
};

(config as any).showDeprecationWarnings = true;
config.global.config.compilerOptions = { ...config.global.config.compilerOptions, whitespace: 'preserve' };
config.global.mocks = {
    ...config.global.mocks,
    $tc: (value: string) => value,
    $t: (value: string) => value,
    $te: () => true,
    $sanitize: (value: string) => value,
    $i18n: { locale: 'en-GB', fallbackLocale: 'en-GB', messages: { 'en-GB': {} } },
    $device: deviceMock,
    $router: routerMock,
    $route: { params: {}, query: {} },
    $store: ShopwareInstance.State?._store,
};
config.global.stubs = {
    ...config.global.stubs,
    'mt-button': true,
    'mt-banner': { template: '<div><slot /></div>' },
    'mt-card': { template: '<div><slot /></div>' },
    'mt-empty-state': { template: '<div><slot /></div>' },
    'mt-icon': true,
    'mt-link': { template: '<a><slot /></a>' },
    'mt-number-field': true,
    'mt-select': true,
    'mt-switch': true,
    'mt-text-field': true,
    'mt-textarea': true,
    'sw-card-view': { template: '<div><slot /></div>' },
    'sw-entity-single-select': true,
    'sw-icon': true,
    'sw-modal': { template: '<div class="sw-modal"><slot /><slot name="modal-footer" /></div>' },
    'sw-page': {
        template: [
            '<div>',
            '<slot name="smart-bar-header" />',
            '<slot name="smart-bar-actions" />',
            '<slot name="content" />',
            '<slot />',
            '</div>',
        ].join(''),
    },
    'sw-search-bar': { template: '<div><slot /></div>' },
};

const i18n = createI18n({
    legacy: false,
    locale: 'en-GB',
    fallbackLocale: 'en-GB',
    messages: {},
    missing: (_locale, key) => key,
});

function syncLocaleState(session: typeof DEFAULT_SESSION_CONTEXT): void {
    const localeFactory = ShopwareInstance.Application.getContainer('factory').locale;
    const registry = localeFactory.getLocaleRegistry() as Map<string, Record<string, unknown>>;

    for (const locale of session.locales) {
        if (!registry.has(locale)) {
            localeFactory.register(locale, {});
        }
    }

    for (const [locale, messages] of registry) {
        i18n.global.setLocaleMessage(locale, messages);
    }

    i18n.global.locale.value = session.locale;
    localeFactory.storeCurrentLocale(session.locale);
    const translate = (...args: unknown[]) => (i18n.global.t as Function)(...args);
    const translationExists = (...args: unknown[]) => (i18n.global.te as Function)(...args);
    config.global.mocks.$t = translate;
    config.global.mocks.$tc = translate;
    config.global.mocks.$te = translationExists;
    config.global.mocks.$i18n = {
        locale: session.locale,
        fallbackLocale: 'en-GB',
        messages: Object.fromEntries(registry),
    };
    ShopwareInstance.Application.view.root.$t = translate;
    ShopwareInstance.Application.view.i18n.global.t = translate;
    ShopwareInstance.Application.view.i18n.global.tc = translate;
    ShopwareInstance.Application.view.i18n.global.te = translationExists;
}

function currentLocaleState(): typeof DEFAULT_SESSION_CONTEXT {
    const sessionStore = getStore('session') ?? getLegacyState('session');
    const systemStore = getStore('system') ?? getLegacyState('system');

    return {
        locales: Array.isArray(systemStore?.locales) && systemStore.locales.length
            ? [...systemStore.locales]
            : [...DEFAULT_SESSION_CONTEXT.locales],
        locale: sessionStore?.currentLocale ?? DEFAULT_SESSION_CONTEXT.locale,
        languageId: sessionStore?.languageId ?? DEFAULT_SESSION_CONTEXT.languageId,
    };
}
const virtualCallStackPlugin = (await import('virtual:vitest-shopware-admin-bridge/virtual-call-stack-plugin')).default;
const meteorSdkDataPlugin = (await import('virtual:vitest-shopware-admin-bridge/meteor-sdk-data-plugin')).default;
const getBlockDataScope = (await import('virtual:vitest-shopware-admin-bridge/block-data-scope')).default;
const blockDataScopePlugin = {
    install(app: any) {
        Object.defineProperty(app.config.globalProperties, '$dataScope', {
            get: getBlockDataScope,
            enumerable: true,
        });
    },
};
config.global.plugins = [
    ...(currentPinia ? [currentPinia] : []),
    virtualCallStackPlugin,
    meteorSdkDataPlugin,
    blockDataScopePlugin,
    i18n,
];

if (runtimeOptions.mode !== 'lite') {
    const directiveRegistry = ShopwareInstance.Directive?.getDirectiveRegistry?.();
    directiveRegistry?.forEach((directive: unknown, name: string) => {
        config.global.directives[name] = (['tooltip', 'popover'].includes(name) ? {} : directive) as any;
    });
}

function syncProvidedServices(): void {
    config.global.provide ??= {};
    for (const serviceName of ShopwareInstance.Service().list()) {
        config.global.provide[serviceName as string] = ShopwareInstance.Service(serviceName);
    }
}

syncProvidedServices();
applyContext();

function cloneState<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

const legacyStore = ShopwareInstance.State?._store;
const initialLegacyState = legacyStore?.state ? cloneState(legacyStore.state) : null;
const serviceRestorers: Array<() => void> = [];

function resetPinia(): void {
    if (!ShopwareInstance.Store?._rootState) {
        return;
    }
    const previous = currentPinia;
    currentPinia = createPinia();
    ShopwareInstance.Store._rootState = currentPinia;
    setActivePinia(currentPinia);
    config.global.plugins = [currentPinia, ...config.global.plugins.filter((plugin) => plugin !== previous)];
}

function restoreServices(): void {
    for (const restore of serviceRestorers.splice(0).reverse()) {
        restore();
    }
}

async function loadComponent(componentName: string, chain = new Set<string>()): Promise<void> {
    if (ShopwareInstance.Component.getComponentRegistry().has(componentName)) {
        return;
    }
    if (chain.has(componentName)) {
        throw new Error(`Circular Shopware component dependency: ${[...chain, componentName].join(' -> ')}`);
    }

    const loader = componentLoaders[componentName];
    if (!loader) {
        throw new Error(
            `Shopware component "${componentName}" is not registered and no Administration source import was found. ` +
            'Import the component explicitly before mounting it.',
        );
    }

    chain.add(componentName);
    if (loader.extends) {
        await loadComponent(loader.extends, chain);
    }
    const imported = await loader.load();
    if (!ShopwareInstance.Component.getComponentRegistry().has(componentName)) {
        const definition = imported.default ?? imported;
        if (loader.extends && loader.extend) {
            ShopwareInstance.Component.extend(componentName, loader.extends, definition);
        } else {
            ShopwareInstance.Component.register(componentName, definition);
        }
    }
    chain.delete(componentName);
}

const consoleGuard = runtimeOptions.strictConsole ? createConsoleGuard(console) : null;
const runtime: ShopwareBridgeRuntime = {
    services,
    loadComponent,
    prepareMount() {
        syncLocaleState(currentLocaleState());
    },
    mockService<T>(name: string, implementation: T): () => void {
        const registry = ShopwareInstance.Service();
        const hadPrevious = new Set<string>(registry.list()).has(name);
        const previous = hadPrevious ? ShopwareInstance.Service(name) : undefined;
        let restored = false;

        bindService(name, implementation);
        config.global.provide[name] = implementation as any;
        const restore = () => {
            if (restored) return;
            restored = true;
            if (hadPrevious) {
                bindService(name, previous);
                config.global.provide[name] = previous;
            } else {
                removeServiceBinding(name);
                Reflect.deleteProperty(config.global.provide, name);
            }
        };
        serviceRestorers.push(restore);
        return restore;
    },
    reset() {
        restoreServices();
        resetPinia();
        if (legacyStore && initialLegacyState && typeof legacyStore.replaceState === 'function') {
            legacyStore.replaceState(cloneState(initialLegacyState));
        }
        resetServiceDefaults();
        registerDefaultServices();
        applyContext();
        syncProvidedServices();
        config.global.mocks.$store = ShopwareInstance.State?._store;
    },
    setAclRoles(roles) {
        aclRoles = roles === null ? null : new Set(roles);
    },
    setFeatureFlags(flags) {
        activeFeatureFlags = new Set(flags);
        const featureTarget = (globalThis as any)._features_ as Record<string, boolean>;
        for (const key of Object.keys(featureTarget)) {
            if (!(key in buildFeatureFlags)) delete featureTarget[key];
        }
        Object.assign(featureTarget, buildFeatureFlags, Object.fromEntries(flags.map((flag) => [flag, true])));
    },
    setContext: applyContext,
    allowConsole(pattern, method) {
        if (!consoleGuard) {
            throw new Error('Strict console mode is disabled. Enable runtime.strictConsole in defineShopwareConfig().');
        }
        consoleGuard.allow(pattern, method);
    },
};

(globalThis as any)[RUNTIME_SYMBOL] = runtime;
enableAutoUnmount(afterEach);
beforeEach(() => {
    runtime.reset();
    consoleGuard?.reset();
});
afterEach(() => {
    try {
        consoleGuard?.assert();
    } finally {
        restoreServices();
    }
});
