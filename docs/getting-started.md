# Set up a Shopware plugin with Vitest

This guide adds Administration unit and component tests to a Shopware plugin,
runs them against every supported Shopware minor in GitHub Actions and makes
the green test job a prerequisite for a release artifact.

The bridge does not download Shopware. Local development uses the
Administration source already present in a Shopware project; CI checks out the
standalone `shopware/administration` repository explicitly.

## 1. Add the Administration test project

Keep the test project next to the plugin's Administration source:

```text
AcmeExample/
├── composer.json
└── src/
    └── Resources/
        └── app/
            └── administration/
                ├── package.json
                ├── package-lock.json
                ├── vitest.config.ts
                ├── src/
                │   └── main.js
                └── test/
                    ├── component/
                    └── core/
```

From `src/Resources/app/administration`, install Vitest and the bridge:

```bash
npm install --save-dev vitest@4 @friendsofshopware/vitest-shopware-admin-bridge
```

Commit both `package.json` and `package-lock.json`, then use `npm ci` locally and
in CI. Do not delete and regenerate the lockfile merely to get a newer bridge
version; update the dependency deliberately and review the resulting lockfile
diff.

Use these scripts in the Administration `package.json`:

```json
{
    "name": "acme-example-administration",
    "private": true,
    "type": "module",
    "scripts": {
        "test:unit": "vitest run",
        "test:unit:watch": "vitest",
        "test:unit:doctor": "vitest-shopware-admin-bridge doctor"
    },
    "devDependencies": {
        "@friendsofshopware/vitest-shopware-admin-bridge": "^0.1.0",
        "vitest": "^4.0.0"
    }
}
```

The exact dependency values written by npm are authoritative; the JSON above
shows the intended shape rather than replacing the generated lockfile.

## 2. Configure Vitest

Create `src/Resources/app/administration/vitest.config.ts`:

```ts
import { defineShopwareConfig } from '@friendsofshopware/vitest-shopware-admin-bridge';

export default defineShopwareConfig({
    runtime: {
        strictConsole: true,
    },
});
```

The default test patterns are:

```text
src/**/*.{spec,test}.{js,ts}
test/**/*.{spec,test}.{js,ts}
```

The bridge always keeps its jsdom bootstrap and required Shopware aliases when
consumer Vitest options are merged. Add extension-specific options below
`vitest` when needed:

```ts
export default defineShopwareConfig({
    runtime: { strictConsole: true },
    vitest: {
        test: {
            include: ['test/unit/**/*.spec.ts'],
            testTimeout: 10_000,
        },
    },
});
```

Prefer the defaults at first. A custom `include` replaces the default patterns,
so every intended test directory must be listed explicitly.

## 3. Install the local Shopware Administration dependencies

The bridge needs the source and `node_modules` of the Shopware Administration
being tested. From a Shopware platform checkout:

```bash
npm ci --prefix src/Administration/Resources/app/administration
```

From a Composer installation:

```bash
npm ci --prefix vendor/shopware/administration/Resources/app/administration
```

The bridge discovers either layout while walking upward from the plugin. For a
different layout, set the path explicitly:

```bash
export SHOPWARE_ADMINISTRATION_PATH=/absolute/path/to/Resources/app/administration
```

Check discovery before debugging a test failure:

```bash
npm run test:unit:doctor
npm run test:unit:doctor -- --json
```

The doctor is read-only. When dependencies are missing, it prints the exact
`npm ci --prefix ...` command instead of modifying the Shopware checkout.

## 4. Write the first tests

Test plain classes without booting an extension entry point. This keeps domain
logic focused even though the shared Shopware environment is available:

```ts
// test/core/price-calculator.spec.ts
import { describe, expect, it } from 'vitest';
import PriceCalculator from '../../src/core/price-calculator';

describe('PriceCalculator', () => {
    it('applies the configured surcharge', () => {
        expect(new PriceCalculator(0.1).calculate(100)).toBe(110);
    });
});
```

For a registered Shopware component, import the extension entry point and mount
the component by its registry name:

```ts
// test/component/acme-widget.spec.ts
import { describe, expect, it } from 'vitest';
import {
    mountShopwareComponent,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';
import '../../src/main';

describe('acme-widget', () => {
    it('renders its title', async () => {
        const wrapper = await mountShopwareComponent('acme-widget', {
            props: { title: 'Orders' },
        });

        expect(wrapper.text()).toContain('Orders');
    });
});
```

Run the suite from the plugin's Administration directory:

```bash
npm run test:unit
npm run test:unit:watch
```

See [testing best practices](best-practices.md) before adding broad fixtures or
copying helpers from Shopware itself.

## 5. Add the GitHub Actions CI matrix

The example below tests a plugin against pinned Shopware 6.6 and 6.7
Administration releases. Replace the refs with patch versions supported by the
plugin and update them intentionally. Add `trunk` only when the plugin promises
forward-compatibility testing; do not make an unreleased branch a release gate
accidentally.

Create `.github/workflows/administration.yml` in the plugin repository:

```yaml
name: Administration

on:
  pull_request:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read

jobs:
  administration-tests:
    name: Tests (Shopware ${{ matrix.shopware }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - shopware: '6.6'
            administration_ref: v6.6.10.23
          - shopware: '6.7'
            administration_ref: v6.7.13.1
    env:
      SHOPWARE_ADMINISTRATION_PATH: ${{ github.workspace }}/.shopware/administration/Resources/app/administration
    steps:
      - name: Checkout plugin
        uses: actions/checkout@v7

      - name: Checkout Shopware Administration
        uses: actions/checkout@v7
        with:
          repository: shopware/administration
          ref: ${{ matrix.administration_ref }}
          path: .shopware/administration

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            src/Resources/app/administration/package-lock.json
            .shopware/administration/Resources/app/administration/package-lock.json

      - name: Install plugin Administration dependencies
        working-directory: src/Resources/app/administration
        run: npm ci

      - name: Install Shopware Administration dependencies
        working-directory: .shopware/administration/Resources/app/administration
        run: npm ci --ignore-scripts

      - name: Diagnose Shopware environment
        working-directory: src/Resources/app/administration
        run: npx vitest-shopware-admin-bridge doctor --json

      - name: Run Administration tests
        working-directory: src/Resources/app/administration
        run: npm run test:unit
```

Why the workflow is structured this way:

- each matrix entry uses the real source and dependencies for that Shopware
  version;
- Shopware refs and both npm lockfiles are explicit and cacheable;
- the plugin and Shopware installations stay separate, matching local
  discovery without mutating either dependency tree;
- `--ignore-scripts` avoids running upstream Administration lifecycle scripts
  that are not needed by the test environment;
- `fail-fast: false` reports compatibility for every supported Shopware minor
  instead of cancelling the remaining evidence after one failure;
- the doctor makes discovery failures distinct from test failures.

The bridge repository already tests its own Node compatibility matrix. A plugin
normally uses one supported Node release and matrices the Shopware versions it
actually supports, which avoids a low-value Cartesian product.

## 6. Gate a release artifact on the tests

Continuous delivery should consume the test job, not rerun a different test
path. The following optional job builds a Shopware extension zip only for a
`v*` tag and only after every Shopware matrix entry passed:

```yaml
  package-extension:
    name: Build release artifact
    if: startsWith(github.ref, 'refs/tags/v')
    needs: administration-tests
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout plugin
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Install Shopware CLI
        uses: shopware/shopware-cli-action@v3

      - name: Build extension zip
        id: extension
        uses: shopware/build-extension-zip-action@v1
        with:
          path: .
          output-directory: .build
          release: true
          use-git-tag-as-version: true

      - name: Upload extension artifact
        uses: actions/upload-artifact@v7
        with:
          name: shopware-extension
          path: ${{ steps.extension.outputs.zip }}
```

This produces a reviewed artifact without granting Store or deployment
credentials to the test workflow. If the plugin already has a release, Store
upload or deployment job, add `needs: administration-tests` to that job and
keep its existing packaging rules. The bridge neither publishes the plugin nor
requires release secrets.

The artifact example uses Shopware's official
[CLI setup action](https://github.com/shopware/shopware-cli-action) and
[extension zip action](https://github.com/shopware/build-extension-zip-action).

## Setup checklist

- The Administration directory has `package.json`, `package-lock.json` and
  `vitest.config.ts`.
- Both local Shopware and plugin dependencies were installed with `npm ci`.
- `vitest-shopware-admin-bridge doctor` reports the intended Administration path and
  Shopware minor.
- Pure logic tests do not import the whole extension entry point.
- Registration and component tests import the entry point deliberately.
- CI pins every supported Shopware minor and reports all matrix results.
- Packaging or deployment jobs depend on the complete Administration test job.
- No publishing or deployment credentials are exposed to pull-request tests.

## Troubleshooting

### Administration source not found

Run the doctor with the intended path:

```bash
npx vitest-shopware-admin-bridge doctor --admin-path /absolute/path/to/Resources/app/administration
```

Then export the same path as `SHOPWARE_ADMINISTRATION_PATH` for Vitest.

### Administration dependencies missing

Use the `installCommand` returned by `doctor --json`. Installing only the
plugin's dependencies is insufficient because the selected Shopware runtime is
authoritative for Vue, state, services and core components.

### No tests are discovered

Keep tests under `src/` or `test/` with `.spec.js`, `.spec.ts`, `.test.js` or
`.test.ts`, or configure a complete `vitest.test.include` list.

### A component is not registered

Import the extension entry point in the spec that tests registration or mount
behavior. Do not add it to a global setup file unless every test genuinely
requires all extension side effects.

### CI passes one Shopware version but fails another

Run the failing ref locally by checking out its standalone Administration and
setting `SHOPWARE_ADMINISTRATION_PATH`. Avoid copying the newer Shopware helper
into the extension; either use a bridge-owned stable helper or keep the
version-sensitive assertion explicit.
