---
'@opulonjs/cms': minor
'@opulonjs/core': minor
---

Breaking: the cms purges cached answers from the Worker's own Workers Cache instead of the zone cache, which never held a Worker's responses. `cloudflareCachePurge()` and its `CMS_CLOUDFLARE_ZONE_ID` / `CMS_CLOUDFLARE_API_TOKEN` settings are gone; put `workersCachePurge(ctx)` in `infra` and set `"cache": { "enabled": true }` in the Wrangler config. A purge also clears a Nuxt site's HTML when it runs in the same Worker and calls the API in-process. core: `createWorker` passes the invocation's `ctx` to `infra(env, ctx)` (and `scheduled` accepts it), `WorkerContext` gains the optional `cache`, and an answer without its own `Cache-Control` is sent `private, no-store`, so Workers Cache never stores a session's reads.
