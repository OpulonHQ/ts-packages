import type { Alternate, PublicSite, ResolvedMenuItem } from '../api.ts'
import { publicPath } from '../public.ts'

/** A system page's public path in the site's locale; null while it is not published there. */
export const systemPageLink = (site: PublicSite, key: string): string | null =>
  site.systemPages[key] ?? null

/** A menu's items with their hrefs resolved for the site's locale; empty when unknown. */
export const menu = (site: PublicSite, key: string): ReadonlyArray<ResolvedMenuItem> =>
  site.menus[key] ?? []

export interface LocaleLink {
  readonly locale: string
  readonly path: string
  readonly current: boolean
}

/**
 * A locale switcher: per content locale, the current page's public path there, else that
 * locale's homepage. Pass any `resolve` answer (redirects and not-found have no alternates).
 */
export const localeLinks = (
  site: PublicSite,
  resolved: { readonly locale: string; readonly alternates?: ReadonlyArray<Alternate> },
): ReadonlyArray<LocaleLink> =>
  site.locales.map((locale) => ({
    locale,
    path:
      resolved.alternates?.find((a) => a.locale === locale)?.path ??
      publicPath(site.locales, locale, '/'),
    current: locale === resolved.locale,
  }))
