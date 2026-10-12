---
'@opulonjs/admin': minor
'@opulonjs/core': minor
'@opulonjs/users': minor
---

Add `@opulonjs/users`: staff sign-in with email and password through Better Auth (login and sessions only, PBKDF2 hashes, its own `pg` pool over the SqlClient's URL, session cookie cache off, same-origin `httpOnly`/`SameSite=Lax` cookies, rate limits per client address in the database), invite-only onboarding (`POST /api/users/invitations`, `users.manage`; the invitee sets a password through the emailed link), password reset by email, deactivated users refused, and `users.*` audit events for sign-in, failed sign-in, sign-out, invitations and resets. `users()` implements core's Authorization middleware from the session (permissions from the user's roles; the built-in Super admin holds every composed permission) and reads Config `USERS_BASE_URL` and `USERS_AUTH_SECRET`. `usersAdmin()` is the admin's auth provider with the sign-in, forgotten password, reset and invitation screens. `opulon users invite-super-admin --server <file> --email <address>` prints the first Super admin's invitation link. Core adds module `commands` for the `opulon` CLI (`opulon <module id> <command>`) and exports `Composed`; the admin shell gets a sign-out button (`AuthProvider.signOut`), `useAdmin().refresh()` and re-exports `useRoute`/`useRouter`.
