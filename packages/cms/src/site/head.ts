import type { PublicSite, ResolvedItem, ResolvedMedia, ResolvedPage } from '../api.ts'

/** The `<head>` of a page or item, in the shape `useHead` (unhead) takes. */
export interface CmsHead {
  readonly title: string
  readonly htmlAttrs: { readonly lang: string }
  readonly meta: ReadonlyArray<{ name?: string; property?: string; content: string }>
  readonly link: ReadonlyArray<{ rel: string; href: string; hreflang?: string }>
  /** Structured data: absent when neither the editor nor the host gave any. */
  readonly script?: ReadonlyArray<{ type: 'application/ld+json'; innerHTML: string }>
}

export interface HeadOptions {
  /** The public origin (`https://example.com`): canonical, hreflang and OG URLs are absolute. */
  readonly origin: string
  /** The host's structured data (for example FAQ items), written after the editor's JSON-LD. */
  readonly jsonLd?: ReadonlyArray<unknown>
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const jsonEscapes: Readonly<Record<string, string>> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}
const ldScript = (json: string) => ({
  type: 'application/ld+json' as const,
  innerHTML: json.replace(/[<>&\u2028\u2029]/g, (char) => jsonEscapes[char]!),
})

/**
 * The SEO head of a resolved page or item: the title through the site's title template, the
 * description and OG tags (the site's default image as fallback), noindex, an absolute canonical
 * (the page's override, else its own URL), hreflang per alternate plus `x-default` (the default
 * locale's path), keywords, Twitter card tags when the site settings hold a handle, and JSON-LD
 * scripts escaped so their content cannot close the script tag.
 */
export const buildHead = (
  resolved: ResolvedPage | ResolvedItem,
  site: PublicSite,
  { origin, jsonLd = [] }: HeadOptions,
): CmsHead => {
  const url = (path: string) => new URL(path, origin).href
  const { seo } = resolved
  const siteName = text(site.settings['siteName'])
  const template = text(site.settings['titleTemplate'])
  const title = !seo.title
    ? siteName
    : template.includes('%s')
      ? template.replaceAll('%s', seo.title)
      : seo.title
  const image = seo.image ?? (site.settings['defaultImage'] as ResolvedMedia | null | undefined)
  const canonical = url(seo.canonical ?? resolved.path)
  const xDefault = resolved.alternates.find((a) => a.locale === site.locales[0])
  const handle = text(site.settings['twitterHandle']).trim()
  const script = [
    ...(seo.jsonLd ? [ldScript(seo.jsonLd)] : []),
    ...jsonLd.map((data) => ldScript(JSON.stringify(data))),
  ]

  const meta: Array<{ name?: string; property?: string; content: string }> = [
    ...(seo.description ? [{ name: 'description', content: seo.description }] : []),
    ...(seo.keywords ? [{ name: 'keywords', content: seo.keywords }] : []),
    ...(seo.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title },
    ...(seo.description ? [{ property: 'og:description', content: seo.description }] : []),
    { property: 'og:url', content: canonical },
    ...(siteName ? [{ property: 'og:site_name', content: siteName }] : []),
    ...(image
      ? [
          { property: 'og:image', content: url(image.url) },
          ...(image.alt ? [{ property: 'og:image:alt', content: image.alt }] : []),
          ...(image.width ? [{ property: 'og:image:width', content: String(image.width) }] : []),
          ...(image.height ? [{ property: 'og:image:height', content: String(image.height) }] : []),
        ]
      : []),
    ...(handle
      ? [
          { name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' },
          { name: 'twitter:site', content: handle.startsWith('@') ? handle : `@${handle}` },
          { name: 'twitter:title', content: title },
          ...(seo.description ? [{ name: 'twitter:description', content: seo.description }] : []),
          ...(image ? [{ name: 'twitter:image', content: url(image.url) }] : []),
        ]
      : []),
  ]
  return {
    title,
    htmlAttrs: { lang: resolved.locale },
    meta,
    link: [
      { rel: 'canonical', href: canonical },
      ...resolved.alternates.map((a) => ({
        rel: 'alternate',
        hreflang: a.locale,
        href: url(a.path),
      })),
      ...(xDefault ? [{ rel: 'alternate', hreflang: 'x-default', href: url(xDefault.path) }] : []),
    ],
    ...(script.length > 0 ? { script } : {}),
  }
}
