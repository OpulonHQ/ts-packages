# Sign in, invitations, password reset

A person invited by email sets a name and password from the invitation link and lands signed in; afterwards they sign in with email and password, and can reset a forgotten password by email. Signed-out visitors to `/admin/**` are sent to sign-in and returned to where they were going.

## Sub-features

- `bootstrap` the first Super admin is invited from the CLI (`opulon users invite-super-admin`).
- `accept` the invitation link opens Accept the invitation; submitting signs in.
- `sign-in` email + password signs in and returns to the redirect target.
- `sign-in-wrong` a wrong password shows the card error and sets no cookie.
- `forgot` Send the link queues a reset email; the link sets a new password.

## How to get to it (user POV)

- Any `/admin/` URL while signed out -> `/admin/sign-in?redirect=...`.
- The emailed link `/admin/accept-invitation?token=...` (first user: printed by the CLI).
- `Forgot your password?` link on sign-in -> `/admin/forgot-password`; emailed `/admin/reset-password?token=...`.

## Driving it with ui.sh

Preconditions: Doctor ok; for `sign-in`, a known account (smoke owner).

- **Sign in.** `$V/ui.sh .claude/skills/verify-host/journeys/sign-in.mjs email=<owner> 'password=smoke password <run>'`. Proves: signed-out `/admin/` lands on `/admin/sign-in`; `POST /api/users/auth/sign-in` 200; sidebar shows `Dashboard` and the user's email; `GET /api/me` 200 with that email; no page errors.
- **Bootstrap + accept (API).** `$V/smoke.sh` steps `bootstrap invite` and `accept the invitation`: inspect 200, accept 204. On a database that already has a Super admin the CLI refuses (`a Super admin already exists`) and the smoke invites through `/api/users/invitations` instead.
- **Accept in the UI.** On a fresh database (`$V/cleanup.sh`, relaunch): `cd fixtures/host && DATABASE_URL_DIRECT=postgres://postgres:postgres@127.0.0.1:54317/tspack_verify USERS_BASE_URL=http://127.0.0.1:<port> node node_modules/@opulonjs/core/dist/cli.mjs users invite-super-admin --server server/opulon.ts --email <address>` prints the link. In a journey: `page.goto(link)`, fill `Your name`, `Password`, click `Accept and sign in`; expect the Dashboard.
- **Wrong password.** Same as sign-in with a bad password: expect `The email or password is wrong.`, URL still `/admin/sign-in`, `/api/me` 401.

## Gotchas

- Use `http://127.0.0.1:<port>`; a `localhost` origin fails the Origin check.
- `page.waitForLoadState('networkidle')` never resolves on the shell; wait for `getByRole('link', { name: 'Dashboard' })`.
- The CLI reads `DATABASE_URL_DIRECT` (direct Postgres URL) and `USERS_BASE_URL` (the link origin); it runs from `packages/core/dist`, so `pnpm build` first.
- Reset and invitation emails are logged, not sent (`Mailer.log`); the link is in the wrangler log and the email log row, not an inbox.
