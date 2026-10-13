---
'@opulonjs/core': minor
---

Add `withTransaction` (nested calls use savepoints), `Background.afterCommit`, scheduled tasks (`tasks: [{ name, every: '5m' | '1h' | '1d', run }]` on `defineModule`, run as the system actor from one `*/5` cron through `createWorker().scheduled`) and `CurrentActor`/`systemActor`. `createWorker` disposes each invocation's runtime only after its background work settled.
