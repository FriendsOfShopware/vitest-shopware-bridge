declare module '*.html.twig' {
    const template: string;
    export default template;
}

declare module '*.twig' {
    const template: string;
    export default template;
}

declare module '*.svg' {
    const svg: string;
    export default svg;
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent;
    export default component;
}
