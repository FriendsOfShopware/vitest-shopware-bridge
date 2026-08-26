import { defineShopwareConfig } from './src/index.js';

export default defineShopwareConfig({
    administrationPath: process.env.SHOPWARE_ADMINISTRATION_PATH,
    runtime: {
        strictConsole: true,
    },
    vitest: {
        test: {
            include: ['test/integration/**/*.spec.ts'],
        },
    },
});
