---
"@opulonjs/admin": patch
"@opulonjs/users": patch
---

The admin shell now shows what the server holds after a sign-out or a language change. Each change ends with a fresh read of `/me` instead of applying its own answer, and only the newest read applies. So a late answer from a previous session, another user or an earlier change can no longer undo a newer state. If that read fails, a ready shell stays up and keeps showing the change for the same user. A read that finds the session ended, a deploy check included, signs the shell out and opens the sign-in screen. A deploy check that shows another account or another language, or answers while a read is still loading, starts a fresh read instead of applying its own answer. New `useAdmin().saveLocale(locale, save)` runs a module's own language save through this path. The account and user screens use it, so they save and apply the language even when the auth provider has no `setLocale`. Module catalogs that load after the admin is unmounted are no longer merged into its messages.
