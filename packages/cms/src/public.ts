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
