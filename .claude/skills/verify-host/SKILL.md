---
name: verify-host
description: Launch and drive the ts-packages fixture host (fixtures/host, the Cloudflare Worker composing every @opulonjs package) locally in workerd, through its admin SPA in headless Chrome and its HTTP API, and capture proof. Use to verify any change to @opulonjs/core, users, emails, media, cms, admin or ui end to end, before claiming it works or opening a PR.
---

# verify-host

The repo ships libraries; the thing a user touches is `fixtures/host`: one Worker serving the admin SPA (`/admin/**`), media originals (`/media/**`) and the composed API (`/api/**`), plus a `*/5` cron that sweeps the email outbox. This skill runs it locally with `wrangler dev` (workerd, local R2 and Workers Cache, Hyperdrive pointed at local Postgres) and drives it like a user.

Other surfaces, not covered here: `fixtures/nuxt` (public Nuxt site; `pnpm --filter @opulonjs-fixtures/nuxt test:built` drives its built Worker), and the real deployed host (`pnpm smoke` against `SMOKE_URL`; see the header of `fixtures/host/wrangler.jsonc`, and never delete a Worker that had a cron).

All paths below are relative to the repo root. Helpers live in `.claude/skills/verify-host/scripts/` (call it `$V`).

## Launch

Preconditions: Postgres 17 from CONTRIBUTING (`docker start tspack-pg17`, `127.0.0.1:54317`, user/pass `postgres`); `DATABASE_URL_TEST` overrides it.

```sh
pnpm build                           # wrangler bundles packages from dist; admin SPA -> fixtures/host/public/admin
cd fixtures/host && wtdev            # foreground: run it with run_in_background, log to a file
```

`wtdev` runs the host's `dev` script (`fixtures/host/scripts/dev.sh`): creates database `tspack_verify` if missing, runs `opulon migrate`, then `wrangler dev` on this worktree's wtdev port (`wtdev port`, e.g. 3181) bound to `127.0.0.1`, with `--test-scheduled` and local vars (`OPULON_BUILD_ID` = HEAD, `USERS_BASE_URL` = `http://127.0.0.1:<port>`, a fixed local auth secret). Ready = the log line `[wrangler:info] Ready on http://127.0.0.1:<port>`; then run Doctor.

- Use `127.0.0.1`, not `localhost`: `USERS_BASE_URL` is the 127.0.0.1 origin and the API rejects a mismatching `Origin`.
- After changing package source: `pnpm build`, then `cd fixtures/host && wtdev restart`. The Worker never sees `src` directly.
- Isolation: one instance per worktree (wtdev port registry). Two worktrees sharing `tspack_verify` would collide: set `VERIFY_DB=tspack_verify_<slug>` for both `wtdev` and the helpers. Never drive a port `wtdev list` does not attribute to this worktree.
- `wtdev -- <cmd>` does not work from the repo root (wtdev still demands a dev target); always `cd fixtures/host` first.

## Doctor

```sh
$V/doctor.sh
```

Read-only. Checks the wtdev server for this worktree is up, `GET /api/me` answers 401 signed out (so the port is ours and the API is composed), the admin `build-id` meta matches HEAD (warns when stale), and the database exists. Prints `doctor: ok http://127.0.0.1:<port> (build <sha>)`.

## Drive

**API, whole user path** (bootstrap invite, accept, sign in, media upload, cms create and publish, Read API with Cache-Tag, email after commit, cron sweep):

```sh
$V/smoke.sh          # runs scripts/smoke.ts against local; triggers the cron via /__scheduled every 5 s
```

Each run creates a fresh owner `owner-<run>@example.test` with password `smoke password <run>` (run id in the `accept the invitation` line). That is the fastest way to get a signed-in Super admin for the UI.

**Admin UI** (headless system Chrome via playwright-core, installed once into `~/.cache/verify-host`):

```sh
$V/ui.sh .claude/skills/verify-host/journeys/sign-in.mjs email=owner-<run>@example.test 'password=smoke password <run>'
```

A journey is a module `export default async ({ page, base, shot, args, check }) => {}`: `page` is a Playwright page, `base` the origin, `shot(name)` a numbered full-page screenshot, `check(cond, msg)` asserts and logs. Write new journeys next to `sign-in.mjs`; per-feature recipes are in `features/`. Selectors: accessible names from the English messages (`packages/*/src/admin/messages/en.ts`), e.g. `getByLabel('Email')`, `getByRole('button', { name: 'Sign in' })`; nav items are links named as in the sidebar (`Dashboard`, `Pages`, `Media`, `Users`, `Email log`, ...).

- Wait on visible elements, never `networkidle`: the shell keeps a request open and it never settles.
- Every page error fails the journey (`no uncaught page errors`).

**Cron by hand:** `curl "http://127.0.0.1:<port>/__scheduled?cron=*/5+*+*+*+*"` -> `Ran scheduled event`.

**DB side effects:** `psql postgres://postgres:postgres@127.0.0.1:54317/tspack_verify`.

## Evidence

Every helper writes to `.verify/<timestamp>/` (git-ignored; set `EVIDENCE_DIR` to group a run): `smoke.log` from the smoke; numbered PNGs, `trace.zip` (open with `pnpm dlx playwright@1.59.1 show-trace`) and `storage-state.json` from UI journeys. Proof standards:

- Drive the real path: admin UI or the public `/api/**` as the SPA calls it, with `Origin` set. No test-only endpoints, no direct table writes to fake a state the UI should create (the CLI bootstrap is a real user path).
- Capture the action and the resulting state: a screenshot before and after, plus the API status the action produced.
- Verify side effects with a second view: the row in Postgres, the R2 object via `GET /media/...`, the email log row's status, the Read API answer and its `Cache-Tag`.
- Mailer is `Mailer.log` (emails are logged, not sent): prove delivery through `/api/emails/log` or the Email log screen, not an inbox.

## Cleanup

```sh
$V/cleanup.sh
```

Stops this worktree's wtdev server, drops `tspack_verify` (`with (force)`), removes `fixtures/host/.wrangler/verify` (local R2/cache). `.verify/` evidence stays. Run it after failed iterations too. It never touches other wtdev servers or the shared Postgres container.

## Helpers

| Script | Use |
| --- | --- |
| `fixtures/host/scripts/dev.sh` | started by `wtdev` in `fixtures/host`; not called directly |
| `$V/doctor.sh` | is the instance worth driving |
| `$V/smoke.sh` | API journey + cron, evidence `smoke.log` |
| `$V/ui.sh <journey.mjs> [k=v ...]` | admin UI journey, evidence PNG/trace |
| `$V/cleanup.sh` | teardown, keeps evidence |
