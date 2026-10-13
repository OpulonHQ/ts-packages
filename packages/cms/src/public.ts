// Read API values the public site shares with the server. Effect-free, so `@opulonjs/cms/site`
// uses them without pulling in the api module.

/**
 * The public path of a locale-relative path: unprefixed in the default locale (the first of
 * `locales`), else `/<locale><path>` (`/<locale>` for the root).
 */
export const publicPath = (locales: ReadonlyArray<string>, locale: string, path: string) =>
  locale === locales[0] ? path : path === '/' ? `/${locale}` : `/${locale}${path}`

/** Cache-Control of every successful Read API answer; publishing purges by Cache-Tag. */
export const readCacheControl = 'public, max-age=0, s-maxage=86400'

/** Bytes of a Cache-Tag header: well under Cloudflare's 16 KiB limit for the whole header. */
const maxCacheTagBytes = 8 * 1024

/**
 * The Cache-Tag header for `tags`, deduplicated. Above 8 KiB the per-document tags
 * (`cms:page:<id>`, `cms:item:<id>`, mostly link targets) collapse into `cms:routes`: every
 * publish, unpublish or delete of a page or item purges it too, so invalidation stays complete,
 * only coarser.
 */
export const cacheTagHeader = (tags: Iterable<string>) => {
  const unique = new Set(tags)
  const header = [...unique].join(',')
  if (new TextEncoder().encode(header).length <= maxCacheTagBytes) return header
  return [
    ...new Set([...unique].map((t) => (/^cms:(?:page|item):/.test(t) ? 'cms:routes' : t))),
  ].join(',')
}
