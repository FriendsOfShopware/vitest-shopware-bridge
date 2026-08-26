import {
    config,
    flushPromises,
    mount,
    shallowMount,
    type ComponentMountingOptions,
    type DOMWrapper,
    type VueWrapper,
} from '@vue/test-utils';
import { vi, type Mock } from 'vitest';
import type { Component, ComponentPublicInstance } from 'vue';
import type {
    ShopwareBridgeRuntime,
    ShopwareTestContext,
    ShopwareTestServices,
} from './setup.js';
import { RUNTIME_SYMBOL } from './setup.js';
import type { ConsoleMessagePattern, GuardedConsoleMethod } from './console.js';

export { config, flushPromises, mount, shallowMount };
export type { ShopwareTestContext, ShopwareTestServices };

function getRuntime(): ShopwareBridgeRuntime {
    const runtime = (globalThis as any)[RUNTIME_SYMBOL] as ShopwareBridgeRuntime | undefined;
    if (!runtime) {
        throw new Error('The Shopware Vitest environment is not initialized. Use defineShopwareConfig().');
    }
    return runtime;
}

export function getShopwareTestServices(): ShopwareTestServices {
    return getRuntime().services;
}

export async function loadShopwareComponent(componentName: string): Promise<void> {
    await getRuntime().loadComponent(componentName);
}

export async function buildShopwareComponent(componentName: string): Promise<Component> {
    await loadShopwareComponent(componentName);
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
    const component = await buildShopwareComponent(componentName);
    getRuntime().prepareMount();
    return mount(component, options);
}

export async function shallowMountShopwareComponent(
    componentName: string,
    options: ComponentMountingOptions<any> = {},
): Promise<VueWrapper> {
    const component = await buildShopwareComponent(componentName);
    getRuntime().prepareMount();
    return shallowMount(component, options);
}

export function mockShopwareService<T>(name: string, implementation: T): () => void {
    return getRuntime().mockService(name, implementation);
}

export async function withShopwareService<T, R>(
    name: string,
    implementation: T,
    callback: () => R | Promise<R>,
): Promise<R> {
    const restore = mockShopwareService(name, implementation);
    try {
        return await callback();
    } finally {
        restore();
    }
}

export function resetShopwareTestState(): void {
    getRuntime().reset();
}

/** `null` keeps the default allow-all ACL behavior. */
export function setAclRoles(roles: readonly string[] | null): void {
    getRuntime().setAclRoles(roles);
}

export function setFeatureFlags(flags: readonly string[]): void {
    getRuntime().setFeatureFlags(flags);
}

export function setShopwareContext(context: ShopwareTestContext): void {
    getRuntime().setContext(context);
}

export function allowConsoleMessage(
    pattern: ConsoleMessagePattern,
    method: GuardedConsoleMethod | 'both' = 'both',
): void {
    getRuntime().allowConsole(pattern, method);
}

export interface RepositoryMock<TEntity = Record<string, unknown>> {
    create: Mock<() => TEntity>;
    get: Mock<(id: string, context?: unknown, criteria?: unknown) => Promise<TEntity | null>>;
    search: Mock<(criteria?: unknown, context?: unknown) => Promise<{ data: TEntity[]; total: number }>>;
    save: Mock<(entity: TEntity, context?: unknown) => Promise<void>>;
    delete: Mock<(id: string, context?: unknown) => Promise<void>>;
}

export function createRepositoryMock<TEntity = Record<string, unknown>>(
    overrides: Partial<RepositoryMock<TEntity>> = {},
): RepositoryMock<TEntity> {
    return {
        create: vi.fn(() => ({} as TEntity)),
        get: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

export function setRepositoryMocks(
    repositories: Record<string, RepositoryMock<any>>,
): ShopwareTestServices['repositoryFactory'] {
    const repositoryFactory = getShopwareTestServices().repositoryFactory;
    repositoryFactory.create.mockImplementation((entityName: string) => {
        const repository = repositories[entityName];
        if (!repository) {
            throw new Error(`No repository mock configured for entity "${entityName}".`);
        }
        return repository;
    });
    return repositoryFactory;
}

export function findByText(
    wrapper: VueWrapper,
    selector: string,
    text: string,
): DOMWrapper<Element> | null {
    return wrapper.findAll(selector).find((element) => element.text().trim() === text) ?? null;
}

export function findByAriaLabel(
    wrapper: VueWrapper,
    selector: string,
    text: string,
): DOMWrapper<Element> | null {
    return wrapper.findAll(selector).find((element) => element.attributes('aria-label')?.trim() === text) ?? null;
}

export function findByLabel(wrapper: VueWrapper, labelText: string): DOMWrapper<Element> | null {
    const label = wrapper.findAll('label').find((element) => element.text().trim() === labelText);
    if (!label) return null;

    const forAttribute = label.attributes('for');
    if (forAttribute) {
        const target = wrapper.findAll('input, textarea, select').find((element) => element.attributes('id') === forAttribute);
        return target ?? null;
    }

    const nested = label.find('input, textarea, select');
    return nested.exists() ? nested : null;
}

export function findByPlaceholder(
    wrapper: VueWrapper,
    placeholder: string,
): DOMWrapper<Element> | null {
    return wrapper
        .findAll('input, textarea, select')
        .find((element) => element.attributes('placeholder') === placeholder) ?? null;
}

const WRAPPER_PLUGIN_SYMBOL = Symbol.for('vitest-shopware-admin-bridge.wrapper-plugin');
if (!(globalThis as any)[WRAPPER_PLUGIN_SYMBOL]) {
    config.plugins.VueWrapper.install((wrapper) => ({
        findByText: (selector: string, text: string) => findByText(wrapper, selector, text),
        findByAriaLabel: (selector: string, text: string) => findByAriaLabel(wrapper, selector, text),
        findByLabel: (text: string) => findByLabel(wrapper, text),
        findByPlaceholder: (text: string) => findByPlaceholder(wrapper, text),
    }));
    (globalThis as any)[WRAPPER_PLUGIN_SYMBOL] = true;
}

export async function selectMtSelectOptionByText(
    wrapper: VueWrapper,
    text: string,
    selector = '.mt-select input',
): Promise<void> {
    const input = wrapper.get(selector);
    await input.trigger('click');
    await flushPromises();

    const option = wrapper
        .findAll('.mt-popover-deprecated li, [role="option"]')
        .find((element) => element.text().trim() === text);
    if (!option) {
        throw new Error(`Could not find Meteor select option "${text}".`);
    }
    await option.trigger('click');
    await flushPromises();
}

declare module '@vue/test-utils' {
    interface VueWrapper<VM = unknown, T extends ComponentPublicInstance = VM & ComponentPublicInstance> {
        findByText(selector: string, text: string): DOMWrapper<Element> | null;
        findByAriaLabel(selector: string, text: string): DOMWrapper<Element> | null;
        findByLabel(text: string): DOMWrapper<Element> | null;
        findByPlaceholder(text: string): DOMWrapper<Element> | null;
    }
}
