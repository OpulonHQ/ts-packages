---
'@opulonjs/admin': minor
'@opulonjs/core': minor
---

Add the rest of core: the `core()` module (hosts list it), `Audit.record` and `diffFields` writing `core.audit_event` in the caller's transaction, the daily `core.audit_purge` retention task (365 days, IP/UA nulled after 90, configurable via `core({ audit })`), `requirePermission` with an anonymous-by-default `CurrentActor` (the Authorization middleware sets the signed-in user, tasks run as the system actor), Effect `Config` read from the Worker env's string values only, and a staff-only `/me` (`private, no-store`) returning the user, admin locale, permission keys, enabled module ids, the permission catalog and the build id. `CurrentUser` now carries `name`, `email` and `locale`; `systemActor` is now a function taking the actor name. The admin's `Me` type follows the richer `/me`.
