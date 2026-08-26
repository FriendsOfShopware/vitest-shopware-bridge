import path from 'node:path';
import type { Plugin } from 'vite';
import type { ResolvedAdministration } from './discovery.js';

const VIRTUAL_MODULES: Record<string, string> = {
    'virtual:vitest-shopware-bridge/admin-core': 'src/core/shopware.ts',
    'virtual:vitest-shopware-bridge/mixins': 'src/app/mixin/index',
    'virtual:vitest-shopware-bridge/directives': 'src/app/directive/index',
    'virtual:vitest-shopware-bridge/filters': 'src/app/filter/index',
    'virtual:vitest-shopware-bridge/state': 'src/app/init-pre/state.init',
    'virtual:vitest-shopware-bridge/component-helper': 'src/app/init/component-helper.init',
};

const STYLE_RE = /\.(?:css|less|scss)(?:\?.*)?$/;
const STYLE_STUB_ID = '\0vitest-shopware-bridge:style';

export function shopwareBridgePlugin(administration: ResolvedAdministration): Plugin {
    return {
        name: 'vitest-shopware-bridge',
        enforce: 'pre',

        resolveId(source) {
            if (source in VIRTUAL_MODULES) {
                return path.join(administration.path, VIRTUAL_MODULES[source]);
            }

            if (STYLE_RE.test(source)) {
                return STYLE_STUB_ID;
            }

            return null;
        },

        load(id) {
            if (id === STYLE_STUB_ID) {
                return 'export default {}';
            }

            return null;
        },

        transform(source, id) {
            if (!/\.(?:html\.twig|twig|html)$/.test(id)) {
                return null;
            }

            const template = source.replace(/<!--[\s\S]*?-->/gm, '').trim();

            return {
                code: `export default ${JSON.stringify(template)};`,
                map: null,
            };
        },
    };
}

