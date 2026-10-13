# Sign in, invitations, password reset

A person invited by email sets a name and password from the invitation link and lands signed in; afterwards they sign in with email and password, and can ask for a password reset link. Signed-out visitors to `/admin/**` are sent to `/admin/sign-in?redirect=<path>` and returned there after signing in.

## Sub-features

- `bootstrap` the first Super admin is invited from the CLI (`opulon users invite-super-admin`), which prints the link.
- `accept` the invitation link opens Accept the invitation; submitting signs in.
- `sign-in` email + password signs in and returns to the redirect target.
- `sign-in-wrong` a wrong password answers 401 and shows `The email or password is wrong.`
- `forgot` Send the link answers 204 and queues a `users.password_reset` email.

## How to get to it (user POV)

- Any `/admin/` URL while signed out -> `/admin/sign-in?redirect=...`.
- The emailed link `/admin/accept-invitation#token=...` (token in the fragment; the screen reads it, then strips it from the address bar).
- `Forgot your password?` link on sign-in -> `/admin/forgot-password`; emailed `/admin/reset-password#token=...`.

## Driving it with ui.sh

Preconditions: Doctor ok; a known account (the smoke owner).

- **Sign in.** `$V/ui.sh .claude/skills/verify-host/journeys/sign-in.mjs email=<owner> 'password=smoke password <run>'`. Clears cookies first. Proves: `/admin/` lands on `/admin/sign-in`; `POST /api/users/auth/sign-in` 200; the sidebar shows `Dashboard` and the user's email; `GET /api/me` 200 with that email.
- **Wrong password + forgot.** `$V/ui.sh .claude/skills/verify-host/journeys/forgot-password.mjs email=<owner>`. Proves: sign-in 401, `role=alert` `The email or password is wrong.`, `/api/me` 401; `Forgot your password?` -> `Send the link` -> `POST /api/users/auth/request-password-reset` 204 and `role=status` `If the address belongs to a user, an email with the link is on its way.` Second view: a `users.password_reset` row in `GET /api/emails/log`.
- **Bootstrap + accept (API).** `$V/smoke.sh` steps `bootstrap invite` and `accept the invitation` (inspect 200, accept 204).
- **Accept in the UI.** Only on a database without a Super admin (`$V/cleanup.sh`, relaunch): `source $V/env.sh && cd fixtures/host && DATABASE_URL_DIRECT="$db_url" USERS_BASE_URL="$base" node node_modules/@opulonjs/core/dist/cli.mjs users invite-super-admin --server server/opulon.ts --email <address>` prints the link. In a journey: `page.goto(link)`, fill `Your name`, `Password`, `Repeat the password`, click `Accept and sign in`; expect the Dashboard.

## Gotchas

- Sign-in is rate limited: after a handful of attempts in a minute it answers 429 `TooManyRequests` with `retryAfter`. Other journeys reuse `.verify/session.json` through `journeys/signed-in.mjs`; don't sign in per journey.
- Use `http://127.0.0.1:<port>`; a `localhost` origin fails the Origin check.
- `page.waitForLoadState('networkidle')` never resolves on the shell; wait for `getByRole('link', { name: 'Dashboard' })`.
- Emailed links can't be recovered from the running host: `Mailer.log` logs only recipient and subject, and the email log has no body. Only the CLI bootstrap prints a link. Reset and later invitations can be proven queued and sent, not followed.
- When a Super admin already exists the CLI refuses (`a Super admin already exists`); the smoke then writes its own invitation token straight into the database, so its accept step does not prove the UI invite path.
