# Fixture host verification map

Maintained source for verifying what a user of a host built from `@opulonjs/*` sees. Read this index, then use the matching feature file as the recipe. Launch, Doctor, helpers and Cleanup are in `../SKILL.md`.

| Feature | File | Packages | Journey |
| --- | --- | --- | --- |
| Sign in, invitations, password reset | [sign-in.md](sign-in.md) | users, admin | `sign-in.mjs`, `forgot-password.mjs`, `smoke.sh` |
| Users and roles | [users-and-roles.md](users-and-roles.md) | users, core | `users-and-roles.mjs` |
| Media library | [media.md](media.md) | media | `media.mjs`, `smoke.sh` |
| CMS pages and Read API | [cms-pages.md](cms-pages.md) | cms | `cms-pages.mjs`, `smoke.sh` |
| Emails: log, templates, outbox | [emails.md](emails.md) | emails, core | `emails.mjs`, `smoke.sh` |
| Server-side list paging and reference picker | [list-paging.md](list-paging.md) | users, cms, core | `list-paging.mjs` |

All journeys last passed together on 2026-10-13. Not mapped: the fixture-only `Notes` demo module (`fixtures/host/modules/demo`), cms Collections, Menus, Site settings and Redirects screens beyond their mention in `cms-pages.md`.

## Baseline preconditions

- `pnpm build` on the commit under test; `cd fixtures/host && wtdev`; `$V/doctor.sh` prints `ok`.
- A Super admin exists: run `$V/smoke.sh` once and take `owner-<run>@example.test` / `smoke password <run>` from its log.
- Drive only the instance on this worktree's `wtdev port`.

## Driving conventions

- Admin UI: `$V/ui.sh <journey.mjs> k=v ...`, journeys in `../journeys/`. Journeys other than `sign-in.mjs` start with `signed-in.mjs`, which reuses `.verify/session.json` and signs in only when it expired.
- Accessible names come from `packages/<pkg>/src/admin/messages/en.ts`. Prefer `getByRole(<role>, { name })`: list screens have `Sort by <column>` buttons and locale tabs mount fields twice, so `getByLabel` often matches two elements.
- Success and failure messages are inline `role=status` / `role=alert`, not toasts.
- API: `curl` with `Origin: $base` and the session cookie, or `page.request` inside a journey.

## Proof and skip reporting

- Set `EVIDENCE_DIR` to group a run's artifacts; name the feature file and sub-feature with each.
- A UI claim needs the before and after screenshot and the API status of the action; a mutation needs a second view (another screen, `/api/...`, or a `psql` row).
- A journey whose precondition the seed data lacks fails and says which; record the reason under that feature's Gotchas. Do not weaken the journey.
- API proof (`smoke.sh`) does not verify the admin screen for the same feature, and the reverse.
