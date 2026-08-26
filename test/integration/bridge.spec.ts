import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import NativeSetup from './fixture/native-setup.vue';
import PlainSfc from './fixture/plain-sfc.vue';
import fixtureTemplate from './fixture/bridge-fixture.html.twig';
import icon from './fixture/test-icon.svg';
import {
    allowConsoleMessage,
    buildShopwareComponent,
    config,
    createRepositoryMock,
    findByLabel,
    getShopwareTestServices,
    loadShopwareComponent,
    mockShopwareService,
    mount,
    mountShopwareComponent,
    resetShopwareTestState,
    setAclRoles,
    setFeatureFlags,
    setRepositoryMocks,
    setShopwareContext,
    withShopwareService,
} from '../../src/test-utils.js';

describe('Shopware Vitest bridge', () => {
    const supportsNativeSetup = existsSync(path.join(
        process.env.SHOPWARE_ADMINISTRATION_PATH ?? '',
        'build/vue-setup-transform/index.ts',
    ));
    it('boots Shopware, transforms Twig and styles, and mounts a registry component', async () => {
        Shopware.Component.register('bridge-fixture', () => import('./fixture/index.js'));

        const wrapper = await mountShopwareComponent('bridge-fixture', { props: { label: 'Clicks' } });

        expect(wrapper.text()).toContain('Clicks: 0');
        expect(wrapper.text()).not.toContain('this must never');
        await wrapper.get('button').trigger('click');
        expect(wrapper.text()).toContain('Clicks: 1');
    });

    it('compiles plain Vue SFCs', () => {
        const wrapper = mount(PlainSfc, { props: { label: 'SFC works' } });

        expect(wrapper.get('.plain-sfc').text()).toBe('SFC works');
    });

    it('applies version-independent Twig and SVG asset contracts', () => {
        expect(fixtureTemplate).toBe([
            '{% block bridge_fixture %}',
            '',
            '<button class="bridge-fixture" type="button" @click="increment">',
            '    {{ label }}: {{ count }}',
            '</button>',
            '{% endblock %}',
            '',
        ].join('\n'));
        expect(icon).toBe([
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">',
            '    <path d="M1 1h14v14H1z" />',
            '</svg>',
            '',
        ].join('\n'));
    });

    it.runIf(supportsNativeSetup)('runs the Administration-native Shopware setup SFC transform', () => {
        const wrapper = mount(NativeSetup);

        expect(wrapper.get('.native-setup').text()).toBe('Native Shopware setup works');
    });

    it('loads core base and extended components without Shopware private test maps', async () => {
        Shopware.Component.override('sw-button', {
            computed: {
                bridgeOverrideApplied: () => true,
            },
        });
        await loadShopwareComponent('sw-button');
        await loadShopwareComponent('sw-entity-listing');

        expect(Shopware.Component.getComponentRegistry().has('sw-button')).toBe(true);
        expect(Shopware.Component.getComponentRegistry().has('sw-data-grid')).toBe(true);
        expect(Shopware.Component.getComponentRegistry().has('sw-entity-listing')).toBe(true);
        await expect(buildShopwareComponent('sw-button')).resolves.toMatchObject({
            computed: expect.objectContaining({ bridgeOverrideApplied: expect.any(Function) }),
        });
    });

    it('loads real Administration parents registered through directory imports', async () => {
        await loadShopwareComponent('sw-settings-index');
        await loadShopwareComponent('sw-media-upload-v2');

        expect(Shopware.Component.getComponentRegistry().has('sw-settings-index')).toBe(true);
        expect(Shopware.Component.getComponentRegistry().has('sw-media-upload-v2')).toBe(true);
    });

    it('provides services to Vue injection and restores scoped service replacements', async () => {
        const originalAcl = Shopware.Service('acl');
        const replacement = { can: vi.fn(() => false) };

        await withShopwareService('acl', replacement, async () => {
            Shopware.Component.register('bridge-injected-service', {
                inject: ['acl'],
                template: '<span class="injected">{{ acl.can("order.viewer") }}</span>',
            });
            const wrapper = await mountShopwareComponent('bridge-injected-service');

            expect(Shopware.Service('acl')).toBe(replacement);
            expect(wrapper.get('.injected').text()).toBe('false');
        });

        expect(Shopware.Service('acl')).toBe(originalAcl);
        expect(config.global.provide.acl).toBe(originalAcl);
    });

    it('returns an explicit restore function for service mocks', () => {
        const original = Shopware.Service('acl');
        const restore = mockShopwareService('acl', { can: () => false });

        expect(Shopware.Service('acl')).not.toBe(original);
        restore();
        expect(Shopware.Service('acl')).toBe(original);
    });

    it('manages ACL roles, feature flags and Administration context', () => {
        setAclRoles(['order.viewer']);
        setFeatureFlags(['FEATURE_NEXT']);
        setShopwareContext({
            api: { languageId: 'custom-language' },
            session: { locale: 'de-DE', locales: ['de-DE'], languageId: 'custom-language' },
        });

        expect(Shopware.Service('acl').can('order.viewer')).toBe(true);
        expect(Shopware.Service('acl').can('customer.viewer')).toBe(false);
        expect(Shopware.Service('feature').isActive('FEATURE_NEXT')).toBe(true);
        expect((globalThis as any)._features_.FEATURE_NEXT).toBe(true);
        expect(Shopware.Context.api.languageId).toBe('custom-language');

        const state = process.env.VITEST_SHOPWARE_VERSION === '6.6' ? Shopware.State : Shopware.Store;
        expect(state.get('context').api.languageId).toBe('custom-language');
        expect(state.get('session').currentLocale).toBe('de-DE');
        expect(state.get('session').languageId).toBe('custom-language');
        expect(state.get('system').locales).toEqual(['de-DE']);
    });

    it('boots standard locales and exposes extension messages through Vue i18n', async () => {
        const localeFactory = Shopware.Application.getContainer('factory').locale;

        expect(localeFactory.getLocaleRegistry().has('en-GB')).toBe(true);
        expect(localeFactory.getLocaleRegistry().has('de-DE')).toBe(true);
        Shopware.Locale.extend('de-DE', { bridge: { greeting: 'Hallo' } });
        setShopwareContext({ session: { locale: 'de-DE', locales: ['de-DE'] } });
        Shopware.Component.register('bridge-locale-fixture', {
            template: '<span class="bridge-locale">{{ $t("bridge.greeting") }}</span>',
        });

        const wrapper = await mountShopwareComponent('bridge-locale-fixture');

        expect(wrapper.get('.bridge-locale').text()).toBe('Hallo');
    });

    it.runIf(process.env.VITEST_SHOPWARE_VERSION !== '6.6')(
        'boots the Administration Pinia stores and a safe notification store',
        async () => {
            expect(Shopware.Store.list()).toEqual(expect.arrayContaining([
                'context',
                'notification',
                'session',
                'settingsItems',
                'system',
            ]));
            expect(Shopware.Store.get('notification').createNotification({ message: 'ignored' })).toBeNull();

            Shopware.Component.register('bridge-notification-fixture', {
                mixins: [Shopware.Mixin.getByName('notification')],
                template: '<span>ready</span>',
                created() {
                    this.createNotificationError({ message: 'expected test notification' });
                },
            });

            await expect(mountShopwareComponent('bridge-notification-fixture')).resolves.toBeDefined();
        },
    );

    it('renders named page slots and content-wrapper slots with the default layout stubs', async () => {
        Shopware.Component.register('bridge-layout-fixture', {
            template: [
                '<sw-page>',
                '<template #content>',
                '<sw-card-view><mt-card><div class="bridge-layout-content">Visible</div></mt-card></sw-card-view>',
                '</template>',
                '</sw-page>',
            ].join(''),
        });

        const wrapper = await mountShopwareComponent('bridge-layout-fixture');

        expect(wrapper.get('.bridge-layout-content').text()).toBe('Visible');
    });

    it('creates predictable repository doubles and routes them by entity name', async () => {
        const productRepository = createRepositoryMock<{ id: string }>({
            search: vi.fn().mockResolvedValue({ data: [{ id: 'product-1' }], total: 1 }),
        });
        setRepositoryMocks({ product: productRepository });

        const repository = Shopware.Service('repositoryFactory').create('product');
        await expect(repository.search()).resolves.toEqual({ data: [{ id: 'product-1' }], total: 1 });
        expect(() => Shopware.Service('repositoryFactory').create('order')).toThrow(
            'No repository mock configured for entity "order"',
        );
    });

    it('starts each reset with a fresh Pinia and default context', () => {
        const previousPinia = Shopware.Store._rootState;
        setShopwareContext({ api: { languageId: 'changed' } });

        resetShopwareTestState();

        expect(Shopware.Store._rootState).not.toBe(previousPinia);
        expect(Shopware.Context.api.languageId).toBe('2fbb5fe2e29a4d70aa5854ce7ce3e20b');
        const state = process.env.VITEST_SHOPWARE_VERSION === '6.6' ? Shopware.State : Shopware.Store;
        expect(state.get('context').api.languageId).toBe('2fbb5fe2e29a4d70aa5854ce7ce3e20b');
        expect(state.get('session').currentLocale).toBe('en-GB');
        expect(state.get('system').locales).toEqual(['en-GB', 'de-DE']);
    });

    it('registers global plugins, directives, standard mocks and wrapper queries', () => {
        const wrapper = mount({
            template: '<label for="bridge-input">Bridge label</label><input id="bridge-input" placeholder="Value">',
        });

        expect(config.global.plugins.length).toBeGreaterThanOrEqual(4);
        expect(config.global.directives).toEqual(expect.any(Object));
        expect(config.global.mocks.$router).toBeDefined();
        expect(config.global.mocks.$device).toBeDefined();
        expect(findByLabel(wrapper, 'Bridge label')?.attributes('id')).toBe('bridge-input');
        expect(wrapper.findByPlaceholder('Value')?.attributes('id')).toBe('bridge-input');
    });

    it('provides resettable practical service defaults', () => {
        const services = getShopwareTestServices();

        expect(Shopware.Service('acl')).toBe(services.acl);
        expect(services.acl.can('order.viewer')).toBe(true);
        expect(services.feature.isActive('FEATURE_NEXT')).toBe(false);
    });

    it('allows deliberate output when strict console mode is enabled', () => {
        allowConsoleMessage('expected bridge warning', 'warn');
        console.warn('expected bridge warning');
    });
});
