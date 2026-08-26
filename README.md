# Vitest Shopware Bridge

`@friendsofshopware/vitest-shopware-bridge` provides a Vitest and Vue Test
Utils environment for Shopware 6 Administration extensions. It boots the real
installed Administration runtime while keeping version-sensitive setup out of
each extension.

The bridge currently supports Shopware 6.6 and 6.7. It also detects and uses
the native Shopware setup-SFC transform when a newer Administration source tree
ships it.

## Requirements

- Shopware 6.6 or 6.7 Administration source and installed npm dependencies
- Node.js 20.19+, 22.12+, or 24
- npm 10+
- Vitest 4

The bridge discovers an Administration in a Shopware monorepo, a Composer
installation, or an npm `administration` link. `SHOPWARE_ADMINISTRATION_PATH`
and the legacy `ADMIN_PATH` can override discovery. Discovery is read-only: the
bridge never downloads or modifies Shopware.

## Setup before the first npm release

npm publishing is intentionally deferred. Install the Git repository; the
consumer lockfile records the exact resolved commit:

```bash
npm install --save-dev vitest github:FriendsOfShopware/vitest-shopware-bridge
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
Consumer options are merged without allowing the mandatory jsdom bootstrap to
be replaced:

```ts
export default defineShopwareConfig({
    administrationPath: process.env.SHOPWARE_ADMINISTRATION_PATH,
    runtime: {
        strictConsole: true,
    },
    vitest: {
        test: {
            include: ['tests/unit/**/*.spec.ts'],
        },
    },
});
```

The configuration installs:

- the correct 6.6 Vue compatibility or 6.7 native Vue runtime;
- Vue SFC compilation and the Administration-native setup transform when present;
- Twig, SCSS/CSS/Less and SVG handling;
- real Shopware component, mixin, directive, filter, state and service registries;
- fresh Pinia and legacy Vuex state for every test;
- Vue Test Utils plugins, dependency injection, i18n and standard Administration mocks.

## Component tests

Import the extension entry point so it registers its components, then mount by
Shopware component name:

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

`loadShopwareComponent()` scans the installed Administration source without
writing Shopware's private generated component map. This allows extensions to
test overrides and extended core components even when their base component was
not registered yet. Dependencies are loaded recursively before
`Shopware.Component.build()` applies the override chain.

```ts
Shopware.Component.override('sw-button', overrideConfig);
await loadShopwareComponent('sw-button');
const component = await buildShopwareComponent('sw-button');
```

Available component utilities:

- `loadShopwareComponent(name)`
- `buildShopwareComponent(name)`
- `mountShopwareComponent(name, options)`
- `shallowMountShopwareComponent(name, options)`
- direct Vue Test Utils exports: `mount`, `shallowMount`, `flushPromises`, `config`

## Services, ACL and feature flags

Default service mocks reset before every test. ACL allows access by default,
feature flags are inactive, user configuration is empty, and repository calls
return empty results.

```ts
import {
    getShopwareTestServices,
    mockShopwareService,
    setAclRoles,
    setFeatureFlags,
    withShopwareService,
} from '@friendsofshopware/vitest-shopware-bridge/test-utils';

setAclRoles(['order.viewer']);
setFeatureFlags(['FEATURE_NEXT']);

const restore = mockShopwareService('myService', { load: vi.fn() });
restore();

await withShopwareService('myService', replacement, async () => {
    // Shopware.Service('myService') and inject('myService') use replacement.
});

getShopwareTestServices().userConfigService.search.mockResolvedValue({ data: {} });
```

Scoped service helpers update both Shopware's Bottle container and Vue
dependency injection, then restore the exact previous instance. Any un-restored
scope is cleaned up automatically after the test.

## Repository doubles

The bridge provides small DAL-shaped doubles rather than Shopware's private
HTTP/entity-schema test infrastructure:

```ts
const products = createRepositoryMock({
    search: vi.fn().mockResolvedValue({
        data: [{ id: 'product-1' }],
        total: 1,
    }),
});

setRepositoryMocks({ product: products });
```

An unconfigured entity name throws immediately instead of silently returning
the wrong fixture.

## Context and state

`setShopwareContext()` updates both `Shopware.Context.api` and the registered
context/session stores where available:

```ts
setShopwareContext({
    api: { languageId: 'language-id' },
    session: { locale: 'de-DE', locales: ['de-DE'], languageId: 'language-id' },
});
```

State is reset automatically. `resetShopwareTestState()` is available when a
single test needs to return to the default API context, services and a fresh
Pinia explicitly.

## Vue wrapper queries and Meteor interaction

The bridge installs these methods on every Vue wrapper and also exports them as
standalone functions:

- `findByText(selector, text)`
- `findByAriaLabel(selector, text)`
- `findByLabel(text)`
- `findByPlaceholder(text)`

`selectMtSelectOptionByText(wrapper, text)` covers the recurring Meteor select
interaction while accepting either the legacy popover or role-based option
markup.

## Strict console mode

Enable `runtime.strictConsole` to fail tests that emit unexpected
`console.warn` or `console.error`. Permit deliberate output in the test that
owns it:

```ts
allowConsoleMessage('expected deprecation', 'warn');
```

Strict mode starts after the Shopware bootstrap, so it reports test behavior
rather than initialization noise.

## Compatibility contract

The bridge deliberately separates stable test adapters from Shopware runtime
behavior.

Bridge-owned adapters behave identically for every supported Administration:

- Twig and imported HTML become ESM strings; HTML and Twig comments are removed
  while all other bytes are preserved;
- SVG imports contain the exact UTF-8 file contents;
- CSS, SCSS and Less imports resolve to an empty module in unit tests;
- jsdom polyfills, repository doubles, queries and console enforcement use the
  bridge's own versioned contracts.

The selected Administration remains authoritative for Vue or Vue compat,
Shopware's component and Twig runtime factories, state, services, mixins,
directives, filters, core components and native setup-SFC transformation. This
keeps the test-facing API stable without making a Shopware 6.6 test silently run
copied 6.7 runtime behavior. The bridge does not import Shopware's private Twig,
SVG or style Vite plugins.

## Diagnostics

```bash
npx vitest-shopware-bridge doctor
npx vitest-shopware-bridge doctor --json
npx vitest-shopware-bridge doctor --admin-path /path/to/administration
```

If dependencies are missing, the command prints the exact `npm ci --prefix ...`
command. It does not run the command automatically.

## Design boundary and compatibility evidence

See [docs/testing-inventory.md](docs/testing-inventory.md) for the Shopware test
pattern inventory, helper ownership decisions, gap-closure table and executable
proof for each compatibility behavior.
