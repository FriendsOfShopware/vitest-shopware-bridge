import { describe, expect, it } from 'vitest';
import { setShopwareContext } from '../../src/test-utils.js';

describe('Shopware Vitest bridge lite runtime', () => {
    it('boots core context without loading Administration UI registrations', () => {
        setShopwareContext({ api: { languageId: 'lite-language' } });

        expect(Shopware.Context.api.languageId).toBe('lite-language');
        expect(Shopware.Component.getComponentRegistry().size).toBe(0);
        expect(() => Shopware.Mixin.getByName('notification')).toThrow('is not registered');
    });
});
