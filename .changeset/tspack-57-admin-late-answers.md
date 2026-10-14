---
"@opulonjs/admin": patch
"@opulonjs/users": patch
---

The admin shell now shows what the server holds after a sign-out or a language change. Each change ends with a fresh read of `/me`, instead of the shell applying the change's own answer. An older read still in flight is dropped. So a late answer, from a previous session, another user, or a slower earlier change, can no longer undo a newer state. If that read fails, a ready shell stays up and keeps showing the change for the same user. A read that finds the session ended, a deploy check included, signs the shell out and opens the sign-in screen. The account and user screens save the admin language through the same path. Module catalogs that load after the admin is unmounted are no longer merged into its messages.
