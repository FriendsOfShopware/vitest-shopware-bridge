import { defineShopwareConfig } from './src/config.js';

export default defineShopwareConfig({
    runtime: {
        mode: 'lite',
        strictConsole: true,
    },
    vitest: {
        test: {
            include: ['test/lite/**/*.spec.ts'],
        },
    },
});
