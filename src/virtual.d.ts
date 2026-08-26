declare module 'virtual:vitest-shopware-bridge/admin-core' {
    export const ShopwareInstance: any;
}

declare module '*.twig' {
    const template: string;
    export default template;
}
