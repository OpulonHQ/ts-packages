import { Background } from '@opulonjs/core'
import type { WorkerContext } from '@opulonjs/core/workers'
import { Context, Data, Effect, Layer, Schedule } from 'effect'

/**
 * Cache-Tags of the Read API (TSPACK-11 §12). Every answer carries `cms`, plus:
 * - a page or item: `cms:page:<id>` / `cms:item:<id>`, and the tags of what its links point at;
 * - a collection list: `cms:collection:<key>` (an item's publish purges its collection);
 * - the site: `cms:site`, plus the tags of what menus, settings links and system pages point at;
 * - a redirect, not found and the sitemaps: `cms:routes`, purged whenever a published path or
 *   a redirect may have changed (any publish, unpublish or delete of a page or item, any
 *   redirect write).
 * A header past 8 KiB collapses the page and item tags into `cms:routes`; still past it, the
 * answer is not edge-cached (`cacheTagHeader`).
 */
export const cacheTags = {
  all: 'cms',
  page: (id: string) => `cms:page:${id}`,
  item: (id: string) => `cms:item:${id}`,
  collection: (key: string) => `cms:collection:${key}`,
  site: 'cms:site',
  routes: 'cms:routes',
} as const

/**
 * Purges edge-cached public responses by Cache-Tag after a publish family write commits. The
 * default does nothing; a host puts `workersCachePurge(ctx)` (or its own purger) in `infra`.
 */
export const CachePurge = Context.Reference<{
  readonly purge: (tags: ReadonlyArray<string>) => Effect.Effect<void>
}>('@opulonjs/cms/CachePurge', { defaultValue: () => ({ purge: () => Effect.void }) })

/** Queues a purge of `tags` to run after the outermost transaction commits. */
export const purgeAfterCommit = (tags: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const cache = yield* CachePurge
    yield* Background.afterCommit(cache.purge(tags))
  })

/** The Worker's own cache, as an invocation's `ctx.cache` holds it. */
export type WorkersCache = NonNullable<WorkerContext['cache']>

/** Tags per purge call (Cloudflare's per-request limit). */
const batch = 100

/** Workers Cache refused a purge (`success: false`), typically its rate limit. */
class PurgeRefused extends Data.TaggedError('PurgeRefused')<{ readonly codes: string }> {}

/**
 * Purges by Cache-Tag from the Worker's own cache (Workers Cache) through the invocation's
 * `ctx.cache`, so the Worker needs `"cache": { "enabled": true }` in its Wrangler config and no
 * token. A purge clears what this Worker cached: the Read API answers and, when the public site
 * runs in the same Worker and calls it in-process with its own `ctx`, the site's HTML. Without
 * `ctx.cache` it does nothing. Workers Cache purges get the Free tier's rate limit (5 a minute,
 * bursts of 25): a refused purge is retried twice, 12 seconds apart (one token's refill), which
 * stays inside the 30 seconds `waitUntil` keeps a Worker alive. A purge still refused, or failed,
 * is logged: the answers then expire with their `s-maxage` (one hour).
 */
export const workersCachePurge = (ctx: { readonly cache?: WorkersCache } | undefined) =>
  Layer.succeed(CachePurge, {
    purge: (tags: ReadonlyArray<string>) => {
      const cache = ctx?.cache
      if (!cache) return Effect.void
      return Effect.forEach(
        Array.from({ length: Math.ceil(tags.length / batch) }, (_, i) =>
          tags.slice(i * batch, (i + 1) * batch),
        ),
        (batchTags) =>
          Effect.gen(function* () {
            // Workers keep `waitUntil` work alive only briefly: a stalled purge must not hold it.
            const result = yield* Effect.tryPromise(() =>
              cache.purge({ tags: [...batchTags] }),
            ).pipe(Effect.timeout('10 seconds'))
            if (!result.success) {
              const codes = result.errors.map((e) => e.code).join(',')
              return yield* new PurgeRefused({ codes })
            }
          }).pipe(
            Effect.retry({
              while: (error) => error instanceof PurgeRefused,
              times: 2,
              schedule: Schedule.spaced('12 seconds'),
            }),
          ),
        { discard: true },
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logError('cms: cache purge failed', { tags: tags.join(',') }, cause),
        ),
      )
    },
  })
