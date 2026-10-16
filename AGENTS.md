# Agent rules

Setup, commands and layout are in `CONTRIBUTING.md`. `pnpm lint`, `pnpm typecheck` and `pnpm test` run the same checks as CI.

Each rule names what enforces it. When a rule is broken twice and nothing enforces it, enforce it (architecture, types, lint, test) before adding words here. Drop a rule once its mistake can no longer be written.

| Rule                                                                                                                                 | Enforced by                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A screen never applies an API answer after it unmounted                                                                              | `useApiClient` drops answers that arrive after its component's scope ended (`packages/admin/src/api-client.ts`, `packages/admin/test/api-client.test.ts`). `{ detached: true }` only for calls handed to an owner that outlives the screen (`saveLocale`) |
| An answer superseded by a newer action or route change is not applied                                                                | Nothing yet: each screen keeps its own request ticket; cms editors use `useAction` (`packages/cms/src/admin/use-cms.ts`). Reuse those, do not write a new guard                                                                                           |
| Tests wait on state (`expect.poll`, `vi.waitFor`, a gate), not on fixed sleeps                                                       | ESLint `tests/no-sleep` (`eslint.config.js`); existing sleeps are counted in `eslint-suppressions.json` and may only go down. A sleep that proves something does not happen gets `// eslint-disable-next-line tests/no-sleep -- <reason>`                 |
| Admin journeys in `fixtures/host/test` mount through `useAdminLifetime()`                                                            | ESLint `no-restricted-imports` on `createAdmin` in fixture tests; existing uses counted in `eslint-suppressions.json`                                                                                                                                     |
| Files are Prettier-formatted before commit                                                                                           | Claude and Codex PostToolUse hooks (`.claude/settings.json`, `.codex/hooks.json`) run `scripts/format-edited.ts`. Everyone: `pnpm lint` in CI                                                                                                             |
| Packages import only along the package graph (ADR 0001)                                                                              | ESLint `no-restricted-imports` per package                                                                                                                                                                                                                |
| Transactions open only through core's `withTransaction`                                                                              | ESLint `no-restricted-syntax`                                                                                                                                                                                                                             |
| Every package change has a changeset                                                                                                 | CI `changeset status`                                                                                                                                                                                                                                     |
| Migration ids are append-only                                                                                                        | CI `scripts/lint-migrations.ts`                                                                                                                                                                                                                           |
| A test fails when the code under test does nothing: show it red against the old code or a mutant before calling it a regression test | Review only                                                                                                                                                                                                                                               |
| Changesets, ADRs, PR bodies and review docs describe the final code, not an earlier round                                            | Review only                                                                                                                                                                                                                                               |
| A shared constant or rule lives in one place; search before writing a second copy                                                    | Review only                                                                                                                                                                                                                                               |
| A fix covers every caller of the function it changes, not only the path the ticket names                                             | Review only                                                                                                                                                                                                                                               |

When a lint rule must be bypassed on a new line, put the reason and an expiry date in the disable comment and get a human's approval in the PR.

## Code Review Rules

Flag only issues this PR introduces that a real caller or input reaches in normal use, at one of:

- P0: data loss, a security hole across a real trust boundary, a broken build or deploy.
- P1: an acceptance-criterion break, a regression against main, or normal use doing a paid or
  user-visible side effect twice (model calls, charges, emails).

Do not flag edge cases normal use does not reach, hardening or defense in depth, validation of data
from our own services, refactors, naming, style, or issues main already has. Do not suggest adding
code unless a P0 or P1 needs it. Most PRs should get no comments.
