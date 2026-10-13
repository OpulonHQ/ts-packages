import { Background } from '@opulonjs/core'
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'

/**
 * Cache-Tags of the Read API (TSPACK-11 §12). Every answer carries `cms`, plus:
 * - a page or item: `cms:page:<id>` / `cms:item:<id>`, and the tags of what its links point at;
 * - a collection list: `cms:collection:<key>` (an item's publish purges its collection);
 * - the site: `cms:site`, plus the tags of what menus, settings links and system pages point at;
 * - a redirect, not found and the sitemaps: `cms:routes`, purged whenever a published path or
 *   a redirect may have changed (any publish, unpublish or delete of a page or item, any
 *   redirect write).
 * A header past 8 KiB collapses the page and item tags into `cms:routes` (`cacheTagHeader`).
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
 * default does nothing; a host puts `cloudflareCachePurge()` (or its own purger) in `infra`.
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

const PurgeResponse = Schema.Struct({ success: Schema.Boolean })
/** Tags per purge request (Cloudflare's per-call limit). */
const batch = 100

/**
 * Purges by Cache-Tag through the Cloudflare API (`POST /zones/<zone>/purge_cache`), with the
 * zone id from `CMS_CLOUDFLARE_ZONE_ID` and a token holding the zone's Cache Purge permission
 * from the `CMS_CLOUDFLARE_API_TOKEN` secret. Without both it does nothing. A failed purge is
 * logged and not retried: cached answers then expire with their `s-maxage` (one day).
 */
export const cloudflareCachePurge = (options: { readonly fetch?: typeof fetch } = {}) =>
  Layer.effect(
    CachePurge,
    Effect.gen(function* () {
      const zone = yield* Config.option(Config.String('CMS_CLOUDFLARE_ZONE_ID'))
      const token = yield* Config.option(Config.Redacted('CMS_CLOUDFLARE_API_TOKEN'))
      const doFetch = options.fetch ?? fetch
      if (Option.isNone(zone) || Option.isNone(token)) return { purge: () => Effect.void }
      const url = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone.value)}/purge_cache`
      const purgeBatch = (tags: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const response = yield* Effect.tryPromise((signal) =>
            doFetch(url, {
              method: 'POST',
              signal,
              headers: {
                authorization: `Bearer ${Redacted.value(token.value)}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({ tags }),
            }),
          ).pipe(Effect.timeout('10 seconds'))
          const body = yield* Effect.promise(() => response.json().catch((): unknown => undefined))
          const ok = Schema.decodeUnknownOption(PurgeResponse)(body).pipe(
            Option.exists((r) => r.success),
          )
          if (!response.ok || !ok)
            return yield* Effect.fail(new Error(`Cloudflare purge failed (${response.status})`))
        })
      return {
        purge: (tags: ReadonlyArray<string>) =>
          Effect.forEach(
            Array.from({ length: Math.ceil(tags.length / batch) }, (_, i) =>
              tags.slice(i * batch, (i + 1) * batch),
            ),
            purgeBatch,
            { discard: true },
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logError('cms: cache purge failed', { tags: tags.join(',') }, cause),
            ),
          ),
      }
    }),
  )
