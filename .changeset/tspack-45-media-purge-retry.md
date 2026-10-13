---
'@opulonjs/core': minor
'@opulonjs/cms': minor
'@opulonjs/media': minor
'@opulonjs/admin': minor
---

Purge cached Read API answers after media metadata edits, replacements, archive, and restore. Answers include media dependency tags, with a broad media fallback for oversized headers.

Core now owns a durable cache purge outbox with three attempts, a bounded scheduled sweep, and a 20-second attempt deadline. CMS and media editors see pending and exhausted failures until cached answers expire. Move host imports of `workersCachePurge` to `@opulonjs/core/workers` and custom purge layers from CMS `CachePurge` to core `CachePurger`; adapters must fail on errors or refusals.

Core exposes sanitized purge status at `GET /api/cache-purges` for permissions declared by producer modules through `cachePurgeStatusAccess`. The CMS status route is removed. Admin exports `CachePurgeNotice`, shared by CMS and media screens.
