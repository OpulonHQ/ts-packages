---
'@opulonjs/core': minor
---

Add a fixed-window rate limiter on Postgres. `RateLimit.hit(key, limit, window)` counts one hit in a single atomic statement and answers `{ allowed: true }` or `{ allowed: false, retryAfter }` (whole seconds until the key's window ends). `hitRateLimit(hyperdrive, key, limit, window)` from `@opulonjs/core/workers` is the same hit as a Promise, for a host route outside the composed API. Migration `0003_create_rate_limit` adds `core.rate_limit`, which stores a SHA-256 of each key, and the new `core.rate_limit_sweep` task deletes ended windows every 5 minutes.
