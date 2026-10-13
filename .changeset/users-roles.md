---
'@opulonjs/users': minor
---

Add roles, permissions and deactivation: the `users.roles.manage` permission, roles API (list, create, edit; Super admin is read-only), role assignment, deactivation (revokes sessions) and reactivation, per-user admin locale, and the Users, Roles and My account admin screens in en + sk. An escalation guard refuses granting a permission or Super admin the actor does not hold, acting on a user who holds more, self-lockout and removing the last active Super admin; changes are serialized by one lock and audited.
