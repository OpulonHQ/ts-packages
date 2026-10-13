---
'@opulonjs/admin': minor
'@opulonjs/core': minor
---

Add the admin skeleton: `defineAdminModule`, `createAdmin` (hides modules missing from `/me`, reload notice on a new build), `useApiClient` for a module's own HttpApi group, and the `opulonAdmin()` Vite preset in `@opulonjs/admin/vite` (build id and API prefix injection). Core adds a minimal `/me` (build id, enabled module ids; `createWorker` now takes `buildId`), `serveAdmin` in `@opulonjs/core/workers` for the `/admin` SPA fallback and immutable assets, and the client-safe `@opulonjs/core/api` entry for module `/api` files.
