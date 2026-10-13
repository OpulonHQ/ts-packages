# Fixture host verification map

Maintained source for verifying what a user of a host built from `@opulonjs/*` sees. Read this index, then use the matching feature file as the recipe. Launch, Doctor, helpers and Cleanup are in `../SKILL.md`.

| Feature | File | Packages | Last proven |
| --- | --- | --- | --- |
| Sign in, invitations, password reset | [sign-in.md](sign-in.md) | users, admin | 2026-10-13 (`journeys/sign-in.mjs`, `smoke.sh`) |
| Users and roles | [users-and-roles.md](users-and-roles.md) | users, core | API via `smoke.sh` only |
| Media library | [media.md](media.md) | media | API via `smoke.sh` only |
| CMS pages and Read API | [cms-pages.md](cms-pages.md) | cms | API via `smoke.sh` only |
| Emails: log, templates, outbox | [emails.md](emails.md) | emails, core | API via `smoke.sh` only |

## Baseline preconditions

- `pnpm build` on the commit under test; `cd fixtures/host && wtdev`; `$V/doctor.sh` prints `ok`.
- A Super admin exists: run `$V/smoke.sh` once and take `owner-<run>@example.test` / `smoke password <run>` from its log.
- Drive only the instance on this worktree's `wtdev port`.

## Driving conventions

- Admin UI: `$V/ui.sh <journey.mjs> k=v ...`, journeys in `../journeys/`. Accessible names come from `packages/<pkg>/src/admin/messages/en.ts`; admin language is English unless the account switched it.
- API: `curl` or the smoke's `api()` pattern with `Origin: http://127.0.0.1:<port>` and the session cookie; every mutating call without a matching Origin is rejected.
- Signing in through the UI first, then reading `/api/...` with `page.evaluate(fetch)`, gives a second view with the same session.

## Proof and skip reporting

- Name the feature file and sub-feature ID with every artifact in `.verify/<timestamp>/`.
- A UI claim needs the before and after screenshot and the API status of the action; a mutation needs a second view (another screen, `/api/...`, or a `psql` row).
- A journey whose precondition the seed data lacks fails and says which; record the reason under that feature's Gotchas. Do not weaken the journey.
- API proof (`smoke.sh`) does not verify the admin screen for the same feature, and the reverse.
