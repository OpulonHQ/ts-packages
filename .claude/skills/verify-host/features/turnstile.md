# Turnstile sign-in guard

With the guard on, staff sign-in and password-reset requests need a Cloudflare Turnstile token, and the sign-in and forgotten-password screens show the widget. Off by default, so every other journey runs without it.

## Sub-features

- `widget` the sign-in and forgotten-password screens load Cloudflare's script and enable the submit button once the widget has a token.
- `refuse` a sign-in or reset request without a token answers 403 `TurnstileFailed`, even with the right password.
- `pass` the widget's token signs in (200) and requests a reset (204).
- `fail` with Cloudflare's always-fail secret the same sign-in answers 403 and shows `The check that you are human did not pass. Try again.`
- `no-site-key` guard on, admin built without the site key: both screens answer 403 and show `The check that you are human is not set up correctly. Contact an administrator.`
- `guard-off` admin built with the site key, guard off: a request with the widget's token answers 403 `TurnstileNotConfigured` and shows the same message; a request without a token works as with no Turnstile at all.
- `blocked` Cloudflare's script does not load: both screens show `The check that you are human did not load. Check your connection or content blocker.` and `Try again` loads it.

## Launch with the guard on

The site key is an admin build option and the rest is Worker env, so both the build and the server need it. Cloudflare's dummy keys work on `127.0.0.1`:

```sh
VITE_USERS_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm build
cd fixtures/host && VERIFY_TURNSTILE=1x0000000000000000000000000000000AA wtdev
```

`VERIFY_TURNSTILE` is the secret: `fixtures/host/scripts/dev.sh` then sets `USERS_TURNSTILE=true`, `USERS_TURNSTILE_SECRET` and `USERS_TURNSTILE_HOSTNAMES=127.0.0.1`. Restart with `VERIFY_TURNSTILE=2x0000000000000000000000000000000AA` for the always-fail secret. The Worker calls the real siteverify, so this needs network.

## Driving it with ui.sh

Preconditions: Doctor ok; an account. `$V/smoke.sh` signs in without a token and fails while the guard is on: create the owner with the guard off (same database), then restart with it on. Every run is `$V/ui.sh .claude/skills/verify-host/journeys/turnstile.mjs email=<owner> 'password=smoke password <run>' mode=<mode>`.

| `mode` | Admin build | Server | Proves |
| --- | --- | --- | --- |
| `pass` (default) | site key | always-pass secret | `widget`, `refuse`, `pass`; second view: a `users.password_reset` row in `GET /api/emails/log` |
| `fail` | site key | always-fail secret | `fail` |
| `blocked` | site key | always-pass secret | `blocked` (the journey aborts requests to `challenges.cloudflare.com`, then lets them through) |
| `guard-off` | site key | no `VERIFY_TURNSTILE` | `guard-off` |
| `no-site-key` | default | always-pass secret | `no-site-key` |

## Gotchas

- The admin build and the server are switched separately. A mismatch in either direction refuses the request and says the check is not set up; it never signs in.
- A dummy secret answers hostname `example.com` and no action, so this setup does not prove the action and hostname comparison; `fixtures/host/test/turnstile.test.ts` does, against a stubbed siteverify.
- Rebuild without the variable and restart without `VERIFY_TURNSTILE` before running other journeys.
