import {
    config,
    flushPromises,
    mount,
    shallowMount,
    type ComponentMountingOptions,
    type VueWrapper,
} from '@vue/test-utils';
import type { Component } from 'vue';
import type { ShopwareTestServices } from './setup.js';

const SERVICE_SYMBOL = Symbol.for('vitest-shopware-bridge.services');

export { config, flushPromises, mount, shallowMount };

export function getShopwareTestServices(): ShopwareTestServices {
    const services = (globalThis as any)[SERVICE_SYMBOL] as ShopwareTestServices | undefined;

    if (!services) {
        throw new Error('The Shopware Vitest environment is not initialized. Use defineShopwareConfig().');
    }

    return services;
}

export async function buildShopwareComponent(componentName: string): Promise<Component> {
    if (!(globalThis as any).Shopware) {
        throw new Error('The Shopware Vitest environment is not initialized. Use defineShopwareConfig().');
    }

    const component = await (globalThis as any).Shopware.Component.build(componentName);
    if (!component || typeof component === 'boolean') {
        throw new Error(`Shopware could not build the component "${componentName}".`);
    }

    return {
        ...component,
        name: `${component.name ?? componentName}__vitest_shopware_bridge`,
    } as Component;
}

export async function mountShopwareComponent(
    componentName: string,
    options: ComponentMountingOptions<any> = {},
): Promise<VueWrapper> {
    return mount(await buildShopwareComponent(componentName), options);
}

