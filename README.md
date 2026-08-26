# Vitest Shopware Bridge

`@friendsofshopware/vitest-shopware-bridge` provides a Vitest environment for
Shopware 6 Administration extensions. It boots the real Administration runtime,
configures Twig and Shopware aliases, and exposes Vue Test Utils helpers with
practical service defaults.

## Requirements

- Shopware 6.6 or 6.7 Administration source
- The Administration's npm dependencies installed
- Node.js 20–24 and npm 10+
- Vitest 4

The bridge deliberately does not download or modify Shopware. It detects the
Administration in a Shopware monorepo, a Composer installation, or an npm
`administration` link. `SHOPWARE_ADMINISTRATION_PATH` and the legacy
`ADMIN_PATH` can override discovery.

## Setup

```bash
npm install --save-dev vitest @friendsofshopware/vitest-shopware-bridge
```

```ts
// vitest.config.ts
import { defineShopwareConfig } from '@friendsofshopware/vitest-shopware-bridge';

export default defineShopwareConfig();
```

```json
{
    "scripts": {
        "test:unit": "vitest run",
        "test:unit:watch": "vitest"
    }
}
```

Tests are discovered under `src/` and `test/` using `.spec.*` or `.test.*`.
Consumer Vitest options can be merged without replacing the bridge bootstrap:

```ts
export default defineShopwareConfig({
    administrationPath: process.env.SHOPWARE_ADMINISTRATION_PATH,
    vitest: {
        test: {
            include: ['tests/unit/**/*.spec.ts'],
        },
    },
});
```

## Component tests

Import the extension entry point so it registers its components, then build and
mount by component name. This applies Shopware's real component and Twig
factories before Vue Test Utils mounts the result.

```ts
import { expect, it } from 'vitest';
import { mountShopwareComponent } from '@friendsofshopware/vitest-shopware-bridge/test-utils';
import '../src/main';

it('renders the widget', async () => {
    const wrapper = await mountShopwareComponent('acme-widget', {
        props: { title: 'Orders' },
    });

    expect(wrapper.text()).toContain('Orders');
});
```

The `./test-utils` export also provides `mount`, `shallowMount`,
`flushPromises`, `config`, and `getShopwareTestServices()`.

```ts
const { acl } = getShopwareTestServices();
acl.can.mockReturnValue(false);
```

Service mocks reset before every test. ACL allows access by default, feature
flags are inactive, user configuration is empty, and repository calls return
an empty result.

## Diagnostics

```bash
npx vitest-shopware-bridge doctor
npx vitest-shopware-bridge doctor --json
npx vitest-shopware-bridge doctor --admin-path /path/to/administration
```

If Administration dependencies are missing, the command prints the exact
`npm ci --prefix ...` command needed to install them. It never runs that command
automatically.

