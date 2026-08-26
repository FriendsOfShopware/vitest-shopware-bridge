# Shopware Administration testing inventory

This inventory defines which recurring Shopware Administration test patterns
belong in `vitest-shopware-admin-bridge` and which should remain in an extension. It
was derived from Shopware trunk at `1bfd59541be45317e8140d23ad1e6fd4721ee43f`
and compared with the `v6.6.9.0` and `v6.7.9.1` trees.

The counts are file matches, not individual test-case counts, and patterns can
overlap. They describe relative usage rather than a coverage metric.

| Pattern | Trunk files |
| --- | ---: |
| Administration and Storefront Administration specs | 1,170 |
| Import `@vue/test-utils` | 801 |
| Call `mount()` | 787 |
| Use Shopware's `wrapTestComponent()` | 722 |
| Use `flushPromises()` | 496 |
| Access `Shopware.Store.get()` | 298 |
| Access `Shopware.Service()` | 146 |
| Use `axios-mock-adapter` | 36 |
| Call `setActivePinia()` | 33 |
| Use `findByText()` | 42 |

The state transition is a compatibility boundary the bridge must hide:

| Pattern | v6.6.9.0 | v6.7.9.1 |
| --- | ---: | ---: |
| Spec files | 988 | 1,058 |
| `wrapTestComponent()` | 646 | 685 |
| `Shopware.State` | 397 | 5 |
| `Shopware.Store.get()` | 72 | 582 |
| `setActivePinia()` | 1 | 32 |

## Ownership decisions

| Testing style | Bridge-owned behavior | Extension-owned behavior |
| --- | --- | --- |
| Plain functions and classes | Vitest configuration only | Domain fixtures and assertions |
| Entry-point registration | Boot the real registries | Import the extension entry point and assert its public registrations |
| Shopware components | Load core dependencies, build inheritance/overrides, mount or shallow-mount | Component props and domain stubs |
| Plain Vue components and mixins | Vue SFC compiler and Vue Test Utils exports | Direct `mount()`/`shallowMount()` choice |
| Pinia/Vuex state | Administration Pinia store initializer, explicit context and safe notification stores, plus fresh Pinia and legacy-state restoration before each test | Store-specific initial values |
| Shopware services | Dependency injection, scoped replacement and restoration | Service-specific return values |
| DAL repositories | Predictable typed repository doubles and entity routing | Entity data and criteria assertions |
| API services | Correct Shopware context | HTTP fixtures and `axios-mock-adapter` scenarios |
| ACL and feature flags | Stable setters with automatic reset | Privileges and flags relevant to the extension |
| Wrapper queries | Reusable text, label, aria-label and placeholder queries | Domain-specific selectors |
| Meteor interactions | A small option-selection helper | Component-specific interaction workflows |
| CMS environments | Nothing beyond the core runtime | CMS block/element fixtures and assertions |
| Time, UUID and entity fixtures | Nothing | Generic or domain-specific utilities |
| Console output | Optional strict failure and per-test allowance | Deliberate message allowances |

## Compatibility ownership contract

The bridge uses a hybrid boundary:

| Bridge-owned and version-independent | Administration-owned and version-correct |
| --- | --- |
| Twig/HTML string loading and comment removal | Shopware component and Twig runtime factories |
| Exact SVG string loading | Vue or Vue compatibility runtime |
| CSS, SCSS and Less test stubs | Pinia/Vuex state and Shopware services |
| jsdom polyfills and strict console enforcement | Mixins, directives, filters and core components |
| Repository doubles and wrapper queries | Native Shopware setup-SFC transformation |

Shopware's private build plugins are not copied or imported. The small asset
adapters are bridge contracts with golden tests; version-semantic behavior is
loaded from the selected Administration and exercised by the real-version CI
matrix.

## Gap closure record

| Original gap | Implemented behavior | Executable proof |
| --- | --- | --- |
| Vue SFC transformation | `@vitejs/plugin-vue` is always installed by `defineShopwareConfig()` | `plain-sfc.vue` integration fixture on 6.6 and 6.7 |
| Native Shopware setup SFCs | The bridge detects and runs the Administration's own `vue-setup-transform` before Vue when that transform is shipped | `native-setup.vue` on trunk plus unit delegation test |
| 6.6 Vue compatibility runtime | Detection prefers `@vue/compat` even when 6.6 also declares Vite; the Vue alias targets the compat ESM runtime | Discovery unit test and complete 6.6 integration suite |
| SVG imports | SVG files are exported as their exact UTF-8 source string by the bridge-owned adapter | Golden adapter test and exact `test-icon.svg` integration assertion |
| Twig comment parity | The bridge-owned adapter removes HTML and Twig comments, including unclosed comments, and preserves every other byte | Golden adapter tests and exact rendered Twig fixture |
| Service injection | Every registered service is copied into Vue Test Utils `global.provide` | Injected-service integration component |
| Shopware directives/plugins | Mixins, directives and filters are imported from source; Pinia, synchronized i18n, Shopware plugins and block data scope are installed globally | Global setup integration assertions and core component loading |
| Standard context | Real context/session/system stores, API/session defaults, standard locales and `$router`, `$route`, `$device`, i18n and sanitizer mocks are installed | Store, locale, context and global-mock integration assertions |
| Fresh state | Pinia is replaced and legacy Vuex, context and locale state are restored before every test and on explicit reset | State-reset integration assertion on 6.6 and 6.7 |
| Scoped service replacement | The bridge safely rebinds Bottle's nested service container and restores the exact previous instance | Service replacement/injection integration tests |
| Core components for extension overrides | A read-only source scanner builds component loaders without Shopware's generated private test map and recursively loads base components | Real `sw-button` override plus `sw-entity-listing`/`sw-data-grid` chain on 6.6 and 6.7 |
| Directory component imports | Import targets are resolved as files first and then through `index.js`/`index.ts`, so page and media overrides load their real parent | Directory-import scanner unit test |
| Pinia store initialization | The 6.7 `store.init` registrations and explicit context store are loaded; a bridge-owned no-op notification store keeps notification mixins independent from workers and HTTP | Real store list plus created-hook notification integration test |
| Layout component stubs | Common page/card wrappers preserve default and named content slots while non-layout controls stay lightweight | Named `sw-page` content integration test |
| Lite runtime | `runtime.mode: 'lite'` retains core context/state while skipping component scanning and UI registries | Dedicated lite integration config on 6.6, 6.7 and trunk |
| Component scan cache | Import maps are persisted per Administration Git revision, with uncached mode available for dirty source development | Cached and uncached scanner unit test |
| Unexpected console output | Opt-in strict mode records warnings/errors, fails after the test and supports explicit allowances | Unit guard test and strict integration suite |

## Deliberate non-goals

The bridge does not copy Shopware's large repository HTTP mock, CMS fixtures,
feature-specific entity schemas, UUID collections, timezone implementation, or
module-specific UI workflows. Those helpers contain private Shopware internals
or domain assumptions and would make the bridge more fragile across patch
releases. The bridge instead supplies the stable seams required to build those
fixtures locally.

The Administration source and npm dependencies remain external. Discovery is
read-only, component scanning writes no files into Shopware, and the bridge
never downloads or modifies Shopware. Its import-map cache lives outside the
Administration tree and can be disabled with `runtime.componentScanCache`.
