import type { PublicSite, ResolvedItem, ResolvedMedia, ResolvedPage } from '../api.ts'

/** The `<head>` of a page or item, in the shape `useHead` (unhead) takes. */
export interface CmsHead {
  readonly title: string
  readonly htmlAttrs: { readonly lang: string }
  readonly meta: ReadonlyArray<{ name?: string; property?: string; content: string }>
  readonly link: ReadonlyArray<{ rel: string; href: string; hreflang?: string }>
}

export interface HeadOptions {
  /** The public origin (`https://example.com`): canonical, hreflang and OG URLs are absolute. */
  readonly origin: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * The SEO head of a resolved page or item: the title through the site's title template, the
 * description and OG tags (the site's default image as fallback), noindex, an absolute canonical,
 * and hreflang per alternate plus `x-default` (the default locale's path).
 */
export const buildHead = (
  resolved: ResolvedPage | ResolvedItem,
  site: PublicSite,
  { origin }: HeadOptions,
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
  const canonical = url(resolved.path)
  const xDefault = resolved.alternates.find((a) => a.locale === site.locales[0])

  const meta: Array<{ name?: string; property?: string; content: string }> = [
    ...(seo.description ? [{ name: 'description', content: seo.description }] : []),
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
  }
}
