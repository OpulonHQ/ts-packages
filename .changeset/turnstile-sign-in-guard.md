---
'@opulonjs/core': minor
'@opulonjs/ui': minor
'@opulonjs/users': minor
---

A host can put a Cloudflare Turnstile check in front of staff sign-in and password-reset requests, and use the same check on its own forms. With `USERS_TURNSTILE=true` in the Worker env, `POST /api/users/auth/sign-in` and `/api/users/auth/request-password-reset` answer 403 `TurnstileFailed` unless the payload's new `turnstileToken` passes, before any user lookup, password check or rate-limit count. The check needs `USERS_TURNSTILE_SECRET` and `USERS_TURNSTILE_HOSTNAMES` (comma-separated); when either is missing, or siteverify fails or does not answer within 5 seconds, every request is refused. `usersAdmin({ turnstile: { siteKey } })` shows the widget on the sign-in and forgotten-password screens. With `USERS_TURNSTILE` unset nothing changes. `verifyTurnstile({ secret, hostnames, action, token })` from the new `@opulonjs/core/turnstile` entry is the server check as a Promise, for a host route: it asks siteverify and compares the action and the hostname. `@opulonjs/ui/components/Turnstile` is the widget for a host form (`v-model` is the token, `site-key` and `action` are props, `reset()` asks for a new token). Cloudflare's dummy keys work for local development: its dummy secrets answer hostname `example.com` and no action, so with one of them those two comparisons are skipped. See the users README.
