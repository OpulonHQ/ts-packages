# Contributing

Requirements: Node 24, pnpm 11 (`corepack enable` picks the version from `package.json`), Docker for Postgres.

## Setup

```sh
pnpm install
docker run -d --name tspack-pg17 -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:54317:5432 postgres:17
export DATABASE_URL_TEST=postgres://postgres:postgres@127.0.0.1:54317/postgres
```

## Commands

| Command           | What it does                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`       | ESLint (including the package graph rules) and Prettier check                                                                                                                                                 |
| `pnpm format`     | Prettier write                                                                                                                                                                                                |
| `pnpm typecheck`  | `tsgo` per package, `vue-tsc` in `ui`, `admin` and `fixtures/host`                                                                                                                                            |
| `pnpm test`       | Vitest against Postgres 17 (needs `DATABASE_URL_TEST`)                                                                                                                                                        |
| `pnpm build`      | tsdown, ESM only, into each package's `dist`; then the fixture host's admin (`vite build` into `fixtures/host/public/admin`)                                                                                  |
| `pnpm pack:check` | Packs every package into a scratch project: imports every export, bundles every `/api` entry for the browser (no server-only imports), compares the fixture's server and admin module ids (run `build` first) |
| `pnpm changeset`  | Records a change for the next release                                                                                                                                                                         |

## Layout

- `packages/*`: the published `@opulonjs/*` packages. Inside the repo they resolve each other to `src` through the `@opulonjs/source` export condition, so no build is needed for typecheck or tests.
- `fixtures/host`: an unpublished host app composing the packages; the main test seam. Its `admin/` builds with the `@opulonjs/admin/vite` preset into `public/admin`, which `worker.ts` serves through `serveAdmin` (Workers static assets). Admin tests mount `createAdmin` in happy-dom with `fetch` routed into the Worker.
- `fixtures/nuxt`: a minimal Nuxt 4 public site over the fixture host, deployed to real Workers to check `@opulonjs/cms/site/nuxt` (deploy steps in its `wrangler.jsonc`). Not part of `pnpm build`. After `pnpm build`, `pnpm --filter @opulonjs-fixtures/nuxt test:built` (with `DATABASE_URL_TEST`) builds it and drives the built Worker's own `fetch` in workerd through Miniflare: a cookie-personalized route must answer `private, no-store` and an opted-in cms page public with its Cache-Tags. Run it when changing `@opulonjs/cms/site/nuxt` or upgrading Nuxt/Nitro; it is not in `pnpm test` (a Nuxt build per run).
- `test/`: repo-level tests and helpers.

## Package graph

`eslint.config.js` enforces the package graph from ADR 0001 with `no-restricted-imports`: on the server `users` may use `emails`, `cms` may use `media`, and every package may use `core`; in the browser `admin` uses `ui` and the client-safe `core/api` contract, and a package's `src/admin/**` entry may use `admin` and `ui`. `@nuxt/ui` may only be imported inside `packages/ui`.

## Database tests

`DATABASE_URL_TEST` points at any database on a Postgres 17 server, with rights to create databases. Each test run creates a template database (`tspack_<run>_template`); each test file clones it:

```ts
import { useTestDatabase } from '../../../test/postgres/index.ts'

const db = useTestDatabase() // fresh clone per file, dropped afterwards; use db.url in tests
```

`createTestDatabase()` returns an extra clone (`{ url, drop }`) when one test needs its own. Package migrations are applied to the template once per run in `test/postgres/global-setup.ts`.

## Replace an admin screen or UI component

Copy the source file from the package's Git tag matching your installed version. Preserve its props and slots, and change private relative imports to public package imports. Put a source header on the first line:

For example, from a checkout of `OpulonHQ/ts-packages`, copy version `0.1.0` to a host file:

```sh
mkdir -p /path/to/host/admin/overrides
printf '%s\n' '<!-- @opulonjs/source @opulonjs/ui@0.1.0 src/components/EmptyState.vue -->' > /path/to/host/admin/overrides/EmptyState.vue
git show '@opulonjs/ui@0.1.0:packages/ui/src/components/EmptyState.vue' >> /path/to/host/admin/overrides/EmptyState.vue
```

```vue
<!-- @opulonjs/source @opulonjs/ui@0.1.0 src/components/EmptyState.vue -->
```

For TypeScript, use `// @opulonjs/source @opulonjs/admin@0.1.0 src/shell/Dashboard.vue`. A single-line `/* @opulonjs/source ... */` comment also works. The header contains the package name, exact SemVer, and original path relative to the package. The Vite preset warns when an imported copy's version is older than the installed package. Compare the upstream source before updating the header. A warning does not stop the build.

Register a screen's host component by route name:

```ts
import Dashboard from './overrides/Dashboard.vue'

createAdmin({ brand, modules, overrides: { dashboard: Dashboard } }).mount('#app')
```

Module routes and the built-in `dashboard`, `core.audit`, and `notFound` routes accept replacements. The original path, navigation, module availability, and access checks remain attached to the route. Unknown names throw before startup. For a lazy replacement, pass Vue's `defineAsyncComponent(() => import('./overrides/Screen.vue'))`.

Register UI components in the Vite config:

```ts
opulonAdmin({
  brand,
  overrides: { components: { EmptyState: './overrides/EmptyState.vue' } },
})
```

Component names are relative to `@opulonjs/ui/components/`, including names such as `Field/Text`. Host paths are absolute or relative to the Vite root. The preset replaces direct imports and imports between kit components. A host copy must not import its own canonical component name, which would resolve back to itself.

The fixture's `admin/overrides/Dashboard.vue` adds “Fixture dashboard override”; its `EmptyState.vue` adds “Fixture UI override”, including empty states inside the kit's DataTable. Run `pnpm build`, start `wtdev` from `fixtures/host`, sign in, and open Dashboard and an empty list to see both. `pnpm pack:check` repeats the alias check using installed tarballs and rejects a bundle containing the original EmptyState.

## Releases

All `@opulonjs/*` packages share one fixed version. They sit at 0.0.0 until the first `minor` changeset releases 0.1.0. Add a changeset to every PR that changes a package (`pnpm changeset`, or `pnpm changeset --empty` when nothing is released). Merging to `main` opens a "version packages" PR; merging that PR publishes to npm with provenance through trusted publishing. The manual **Snapshot** workflow publishes pending changes as `<version>-next-<timestamp>` under the `next` dist-tag.

Packages are marked `"private": true` until they are ready for their first release; remove the flag to let the release workflow publish them.

There are no git hooks; CI runs every check.
