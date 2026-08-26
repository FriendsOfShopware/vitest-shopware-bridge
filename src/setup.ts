import { afterEach, beforeEach, vi, type Mock } from 'vitest';
import { createApp } from 'vue';
import { config, enableAutoUnmount } from '@vue/test-utils';

type ServiceMock = Record<string, Mock>;

export interface ShopwareTestServices {
    acl: ServiceMock;
    feature: ServiceMock;
    repositoryFactory: ServiceMock;
    userConfigService: ServiceMock;
}

declare global {
    // The actual Shopware type is supplied by an extension's Administration typings.
    // eslint-disable-next-line no-var
    var Shopware: any;
}

const SERVICE_SYMBOL = Symbol.for('vitest-shopware-bridge.services');
const shopwareVersion = process.env.VITEST_SHOPWARE_VERSION;
const featureFlags = shopwareVersion === '6.6' ? { ADMIN_VITE: true } : {};

Object.assign(globalThis, {
    _features_: featureFlags,
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

const { ShopwareInstance } = await import('virtual:vitest-shopware-bridge/admin-core');

globalThis.Shopware = ShopwareInstance;
(window as any).Shopware = ShopwareInstance;
createApp({}).use(ShopwareInstance.Store._rootState);

for (const moduleName of [
    'virtual:vitest-shopware-bridge/mixins',
    'virtual:vitest-shopware-bridge/directives',
    'virtual:vitest-shopware-bridge/filters',
    'virtual:vitest-shopware-bridge/state',
    'virtual:vitest-shopware-bridge/component-helper',
]) {
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

function resetServiceDefaults(): void {
    services.acl.can.mockReset().mockReturnValue(true);
    services.feature.isActive.mockReset().mockReturnValue(false);
    services.repositoryFactory.create.mockReset().mockReturnValue({
        create: vi.fn(),
        get: vi.fn(),
        search: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    });
    services.userConfigService.search.mockReset().mockResolvedValue({ data: {} });
    services.userConfigService.upsert.mockReset().mockResolvedValue(undefined);
}

resetServiceDefaults();

const serviceRegistry = ShopwareInstance.Service();
serviceRegistry.register('acl', () => services.acl);
serviceRegistry.register('feature', () => services.feature);
serviceRegistry.register('repositoryFactory', () => services.repositoryFactory);
serviceRegistry.register('userConfigService', () => services.userConfigService);

(globalThis as any)[SERVICE_SYMBOL] = services;

config.global.mocks = {
    ...config.global.mocks,
    $sanitize: (value: string) => value,
    $t: (key: string) => key,
    $tc: (key: string) => key,
    $te: () => true,
};

config.global.stubs = {
    ...config.global.stubs,
    'mt-button': true,
    'mt-icon': true,
    'mt-number-field': true,
    'mt-select': true,
    'mt-switch': true,
    'mt-text-field': true,
    'mt-textarea': true,
    'sw-entity-single-select': true,
    'sw-modal': {
        template: '<div class="sw-modal"><slot /><slot name="modal-footer" /></div>',
    },
};

enableAutoUnmount(afterEach);
beforeEach(resetServiceDefaults);
