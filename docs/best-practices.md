# Testing best practices for Shopware Administration extensions

The bridge makes the real Shopware Administration runtime available, but a good
test suite still uses the smallest runtime surface needed to prove a behavior.
These practices keep failures local, fixtures understandable and compatibility
results meaningful across Shopware versions.

## Choose the narrowest useful test

| Behavior under test | Preferred test | Bridge support |
| --- | --- | --- |
| Plain function, class or normalization rule | Import it directly and assert inputs/outputs | Vitest environment |
| Extension registration | Import `src/main` and inspect the public Shopware registry | Real Shopware registries |
| Shopware component template, props or emitted events | Mount by registry name | `mountShopwareComponent()` |
| Parent rendering is irrelevant | Shallow-mount by registry name | `shallowMountShopwareComponent()` |
| Plain Vue component | Mount the component object directly | Re-exported `mount()`/`shallowMount()` |
| Shopware service collaboration | Replace only the service seam | `withShopwareService()` |
| DAL repository collaboration | Use a small entity-routed double | `createRepositoryMock()` |
| ACL, feature flag or context branch | Set the relevant runtime input | ACL, feature and context setters |
| Real navigation, HTTP stack or browser integration | End-to-end test | Deliberately outside the bridge |

Do not mount a page to prove a calculation that can be tested as a plain class.
Conversely, do not replace the entire Shopware component registry with stubs
when the inheritance or override chain is the behavior being tested.

## Keep entry-point side effects deliberate

Import `src/main` only in tests that need the extension's registrations. Module
imports and Shopware registrations persist within a Vitest worker even though
state and service mocks reset between tests.

Good registration contract:

```ts
import { describe, expect, it } from 'vitest';

describe('Administration entry point', () => {
    it('registers the settings page', async () => {
        await import('../src/main');

        expect(Shopware.Component.getComponentRegistry().has('acme-settings')).toBe(true);
    });
});
```

Avoid importing the entry point from a consumer `setupFiles` module. That makes
every plain unit test depend on all registration side effects and makes import
order harder to reason about.

## Import Vue Test Utils through the bridge

The test-utils entry point re-exports `mount`, `shallowMount`, `flushPromises`
and `config`, and adds Shopware-specific mounting and query helpers:

```ts
import {
    flushPromises,
    mountShopwareComponent,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';
```

This keeps the test on the Vue Test Utils instance selected for the detected
Administration. Prefer `mountShopwareComponent()` when the component is
registered through `Shopware.Component`; prefer direct `mount()` for a plain
Vue component object.

Use a full mount when child behavior, slots, dependency injection or Shopware
component inheritance matters. Use a shallow mount when the parent contract is
the only subject and name each deliberate child stub in the test.

## Assert behavior instead of implementation structure

Prefer emitted events, visible text, accessible labels and calls across a
public service boundary. Avoid assertions against private component fields,
generated Vue names or Shopware's internal registry representation.

The bridge installs wrapper queries and exports equivalent standalone helpers:

```ts
const saveButton = wrapper.findByText('button', 'Save');
const titleInput = wrapper.findByLabel('Title');

expect(saveButton).not.toBeNull();
expect(titleInput).not.toBeNull();
```

Await Vue interactions and pending promises before asserting their effects:

```ts
await wrapper.get('button').trigger('click');
await flushPromises();

expect(wrapper.emitted('save')).toHaveLength(1);
```

CSS classes are reasonable selectors when the class is part of the extension's
own stable UI contract. Do not couple an extension test to generated markup of
a Shopware or Meteor child when a role, label, emitted event or service call can
prove the same behavior.

## Replace boundaries, not the code under test

Use scoped service replacement so the exact previous service instance is
restored even when the assertion fails:

```ts
import { vi } from 'vitest';
import {
    withShopwareService,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';

const load = vi.fn().mockResolvedValue({ total: 3 });

await withShopwareService('acmeReportService', { load }, async () => {
    // Exercise the component or class that resolves the service.
});

expect(load).toHaveBeenCalledOnce();
```

Use `mockShopwareService()` only when the replacement must span several calls
inside one test, and call its restore function. The bridge also cleans an
unrestored scope after the test, but explicit lifetimes make intent clearer.

Repository doubles should contain domain data but retain the DAL-shaped
contract:

```ts
import { vi } from 'vitest';
import {
    createRepositoryMock,
    setRepositoryMocks,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';

const productRepository = createRepositoryMock({
    search: vi.fn().mockResolvedValue({
        data: [{ id: 'product-1', name: 'Example' }],
        total: 1,
    }),
});

setRepositoryMocks({ product: productRepository });
```

An unconfigured entity throws immediately. Configure every expected repository
explicitly rather than providing one permissive repository for every entity.

Keep HTTP response details, entity factories, CMS fixtures and feature-specific
workflows in the extension. They encode domain assumptions and are intentionally
not bridge helpers.

## Control ACL, flags and context explicitly

Defaults are intentionally convenient: ACL allows access, feature flags are
inactive and repository queries return empty results. A test for one of those
branches should state the relevant input:

```ts
import {
    setAclRoles,
    setFeatureFlags,
    setShopwareContext,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';

setAclRoles(['order.viewer']);
setFeatureFlags(['FEATURE_NEXT']);
setShopwareContext({
    api: { languageId: 'language-id' },
    session: { locale: 'de-DE', locales: ['de-DE'] },
});
```

Do not depend on the default allow-all ACL in a permission test. Do not toggle
Shopware's private feature structures directly when `setFeatureFlags()` covers
the public behavior.

The bridge boots the real context/session/system stores, creates fresh Pinia
state, restores legacy Vuex state, resets context and locales, and reinstalls
default service behavior before every test. Use
`resetShopwareTestState()` inside a test only when that reset is itself part of
the scenario; routine cleanup belongs to the automatic lifecycle.

## Treat console output as a test failure

Enable strict console mode in the shared configuration:

```ts
export default defineShopwareConfig({
    runtime: { strictConsole: true },
});
```

Fix unexpected Vue warnings and errors instead of globally suppressing them.
For a deliberate warning, permit the smallest message pattern in the test that
owns it:

```ts
import {
    allowConsoleMessage,
} from '@friendsofshopware/vitest-shopware-admin-bridge/test-utils';

allowConsoleMessage('expected deprecation', 'warn');
```

An allowance should be as specific as the assertion and should not live in a
global setup file.

## Keep fixtures local and typed

- Put small fixtures next to the test or in a feature-local fixture module.
- Build only fields read by the code under test.
- Give repeated domain fixtures a typed factory owned by the extension.
- Avoid one global entity fixture that silently accumulates unrelated fields.
- Use deterministic IDs, dates and ordering.
- Assert the criteria or payload sent to a dependency when query construction
  is part of the behavior.

This boundary makes a fixture change explain a domain change instead of a
Shopware-version change.

## Test supported Shopware versions, not copied internals

The selected Administration remains authoritative for Vue, state, services,
registries, core components and the native setup-SFC transform. Do not copy a
private Shopware test helper into an extension merely to make one version pass.

Bridge-owned helpers are appropriate when all supported versions should expose
the same test-facing contract, such as:

- mounting a registered component;
- replacing and restoring a service;
- setting ACL, feature flags or API context;
- creating a small DAL-shaped repository double;
- querying wrappers by visible or accessible text;
- loading Twig, SVG and style imports consistently.

Extension-owned helpers are appropriate when they express a domain concept,
HTTP fixture, CMS schema, entity factory or multi-step feature workflow.

Pin released Shopware refs in the required CI matrix. A `trunk` entry is useful
as an allowed forward-compatibility signal or as a required gate only when that
policy is intentional. Keep `fail-fast: false` so a compatibility failure does
not erase evidence for the other supported versions.

## Review checklist

- Does the test use the narrowest runtime surface that proves the behavior?
- Is `src/main` imported only because registration is relevant?
- Are Vue interactions and promises awaited?
- Are state, ACL, flags, context and service replacements explicit?
- Are mocks placed at a public boundary instead of replacing the subject?
- Are selectors based on behavior or accessible output?
- Is deliberate console output narrowly allowed?
- Are domain fixtures owned by the extension?
- Does CI cover every Shopware minor declared by the plugin?
- Would a copied Shopware private helper be better expressed as a stable bridge
  helper or an extension-local domain helper?

For the concrete files and workflow, continue with the
[new plugin setup and CI/CD guide](getting-started.md). For the reasoning behind
the bridge boundary, see the [Shopware testing inventory](testing-inventory.md).
