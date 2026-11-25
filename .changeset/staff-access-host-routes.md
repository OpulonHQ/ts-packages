---
'@opulonjs/core': minor
'@opulonjs/users': minor
---

Host routes outside the composed API can check the staff session. `staffAccess(server, { database })` from `@opulonjs/users/server` returns `session(request, env)`, which resolves with the signed-in staff user and their permissions or `undefined`, and `require(request, env, permission)`, which resolves with the user or with the 401 or 403 response the composed API answers. Both take a plain `Request`, return Promises and read the session and roles from Postgres on every call. `composeServer` takes a `permissions` option with the host's own permission keys; they join the catalog, so the Roles screen offers them. `@opulonjs/core` also exports `holdsPolicy`, and `@opulonjs/core/workers` exports `envConfig`. See the `@opulonjs/users` README for a Nuxt example.
