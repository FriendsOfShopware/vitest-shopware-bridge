import { describe, expect, it } from 'vitest';
import { getShopwareTestServices, mountShopwareComponent } from '../../src/test-utils.js';

describe('Shopware Vitest bridge', () => {
    it('boots Shopware, builds a Twig component and mounts it with Vue Test Utils', async () => {
        Shopware.Component.register('bridge-fixture', () => import('./fixture/index.js'));

        const wrapper = await mountShopwareComponent('bridge-fixture', {
            props: { label: 'Clicks' },
        });

        expect(wrapper.text()).toContain('Clicks: 0');
        await wrapper.get('button').trigger('click');
        expect(wrapper.text()).toContain('Clicks: 1');
    });

    it('provides resettable practical service defaults', () => {
        const services = getShopwareTestServices();

        expect(Shopware.Service('acl')).toBe(services.acl);
        expect(services.acl.can('order.viewer')).toBe(true);
        expect(services.feature.isActive('FEATURE_NEXT')).toBe(false);
    });
});
