declare module 'virtual:vitest-shopware-admin-bridge/admin-core' {
    export const ShopwareInstance: any;
}

declare module 'virtual:vitest-shopware-admin-bridge/component-loaders' {
    const loaders: Record<
        string,
        {
            load: () => Promise<any>;
            register: boolean;
            extends?: string;
            extend: boolean;
        }
    >;
    export default loaders;
}

declare module 'virtual:vitest-shopware-admin-bridge/runtime-options' {
    const options: { strictConsole: boolean };
    export default options;
}

declare module 'virtual:vitest-shopware-admin-bridge/core-stores' {
    const initialized: true;
    export default initialized;
}

declare module 'virtual:vitest-shopware-admin-bridge/virtual-call-stack-plugin' {
    const plugin: any;
    export default plugin;
}

declare module 'virtual:vitest-shopware-admin-bridge/meteor-sdk-data-plugin' {
    const plugin: any;
    export default plugin;
}

declare module 'virtual:vitest-shopware-admin-bridge/block-data-scope' {
    const getBlockDataScope: () => unknown;
    export default getBlockDataScope;
}
