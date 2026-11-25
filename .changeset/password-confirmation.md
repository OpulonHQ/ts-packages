---
'@opulonjs/core': minor
'@opulonjs/users': minor
'@opulonjs/admin': minor
---

An endpoint can require a recent password confirmation. Annotate it with `Sensitive` from `@opulonjs/core/api` (`.annotate(Sensitive, true)`, next to its `Policy`): a session that has not confirmed its password within the window gets 403 `PasswordConfirmationRequired`, after the session and permission checks. `POST /api/users/password-confirmation` with the user's password confirms the session that sent it; it allows 5 attempts a minute per client address and writes the audit event `users.password_confirmation_failed` for a wrong password. The window is 5 minutes, or the duration in `USERS_PASSWORD_CONFIRM_WINDOW`. Requests made through `useApiClient` need no code: the admin shell answers the refusal with one password dialog and sends the request once more, and repeats nothing when the user cancels or leaves the screen. Host routes outside the composed API check the same with `staff.require(request, env, permission, { sensitive: true })`. Migration `0005_session_password_confirmed_at` adds a column to `users.session`. An auth provider gets the dialog by implementing `AuthProvider.confirmPassword`; `usersAdmin()` does. Core's `authorization(authenticate)` accepts `{ user, passwordConfirmed }`; a lookup that returns only a user never passes a `Sensitive` endpoint.
