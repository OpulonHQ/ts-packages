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

From your host project root, copy the installed EmptyState module and record its installed version. This works before release tags exist:

```sh
node --input-type=module <<'JS'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative } from 'node:path'
let require = createRequire(import.meta.url)
try { require.resolve('@opulonjs/ui/package.json') }
catch { require = createRequire(require.resolve('@opulonjs/admin/package.json')) }
const manifest = require.resolve('@opulonjs/ui/package.json')
const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
const original = require.resolve('@opulonjs/ui/components/EmptyState')
const source = readFileSync(original, 'utf8').replace(
  /^import UIcon from ["']@nuxt\/ui\/components\/Icon\.vue["'];?$/m,
  'import { UIcon } from "@opulonjs/ui";'
)
if (!source.includes('from "@opulonjs/ui"')) throw new Error(`no Nuxt UI icon import to replace in ${original}`)
mkdirSync('admin/overrides', { recursive: true })
writeFileSync('admin/overrides/EmptyState.mjs',
  `// @opulonjs/source @opulonjs/ui@${version} ${relative(dirname(manifest), original)}\n${source}`)
JS
```

Register this file as `EmptyState: './overrides/EmptyState.mjs'` in the Vite options below. The command copies compiled Vue code and replaces its Nuxt UI import with the kit's public export. Preserve props and slots when editing it. For other files, change private imports to public package imports. If you copy Vue source from the repository, put a header on its first line:

```vue
<!-- @opulonjs/source @opulonjs/ui@0.1.0 src/components/EmptyState.vue -->
```

For TypeScript, use `// @opulonjs/source @opulonjs/admin@0.1.0 src/shell/Dashboard.vue`. A single-line `/* @opulonjs/source ... */` comment also works. The header contains the package name, exact SemVer, and original path relative to the package. The Vite preset warns when an imported copy's version is older than the installed package. Compare the upstream source before updating the header. A warning does not stop the build.

Keep copied screens in an `overrides/` directory under the Vite root. With component overrides configured, the build warns once per file when a registered component or an imported file under that directory is missing its source header. A malformed header warns as invalid in any imported file. Headers may start with a UTF-8 BOM and use CRLF. If the host cannot resolve a package version, the preset tries its own dependencies, then warns that it could not check the version.

Register a screen's host component by route name:

```ts
createAdmin({
  brand,
  modules,
  overrides: { dashboard: () => import('./overrides/Dashboard.vue') },
}).mount('#app')
```

Module routes and the built-in `dashboard`, `core.audit`, and `notFound` routes accept replacements. The original path, navigation, module availability, and access checks remain attached to the route. Unknown names throw before startup. Pass a host component or a lazy loader returning a component or its default-export module. A dynamic import keeps the copied screen in a separate chunk.

For functional components that need Vue props, slots, or composables, use `defineComponent` or set the function's `displayName`, so Vue Router treats it as a component rather than invoking it as a loader.

Register UI components in the Vite config:

```ts
opulonAdmin({
  brand,
  overrides: { components: { EmptyState: './overrides/EmptyState.vue' } },
})
```

Component names are relative to `@opulonjs/ui/components/`, including names such as `Field/Text`. Host paths are absolute or relative to the Vite root. The preset replaces direct imports and imports between kit components. A host copy can import its own canonical name to wrap the original component; that import resolves to the package's original file.

Only an exact canonical self-import from the override file resolves to the original. A helper module importing that same name receives the host copy; using it to wrap the original would cause recursive rendering.

The fixture's `admin/overrides/Dashboard.vue` adds “Fixture dashboard override”; its `EmptyState.vue` adds “Fixture UI override”, including empty states inside the kit's DataTable. Run `pnpm build`, start `wtdev` from `fixtures/host`, sign in, and open Dashboard and an empty list to see both. `pnpm pack:check` repeats the alias check using installed tarballs and rejects a bundle containing the original EmptyState.

## Releases

All `@opulonjs/*` packages share one fixed version. They sit at 0.0.0 until the first `minor` changeset releases 0.1.0. Add a changeset to every PR that changes a package (`pnpm changeset`, or `pnpm changeset --empty` when nothing is released). Merging to `main` opens a "version packages" PR; merging that PR publishes to npm with provenance through trusted publishing. The manual **Snapshot** workflow publishes pending changes as `<version>-next-<timestamp>` under the `next` dist-tag.

Packages are marked `"private": true` until they are ready for their first release; remove the flag to let the release workflow publish them.

There are no git hooks; CI runs every check.
