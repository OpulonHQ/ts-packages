// A plain typed wrapper of the Read API (TSPACK-19 decision 1). Type-only imports from the api
// module: the public site bundle must not load Effect or HttpApiClient.
import type { ItemPreview, PagePreview, PublicItems, PublicSite, ResolveResult } from '../api.ts'

/** A Read API answer that was not a success (4xx/5xx). */
export class CmsRequestError extends Error {
  override readonly name = 'CmsRequestError'
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`cms: ${url} answered ${status}`)
  }
}

export interface CollectionQuery {
  readonly locale?: string
  /** 1-based (default 1). */
  readonly page?: number
  /** 1 to 100 (default 20). */
  readonly perPage?: number
  readonly sort?: 'newest' | 'oldest'
  /** Only items whose reference fields hold this item id. */
  readonly ref?: string
  /** Only these item ids (at most 100). */
  readonly ids?: ReadonlyArray<string>
}

export interface CmsClientOptions {
  /** On Workers SSR the in-process fetch (`@opulonjs/cms/site/nuxt`), else the real one. */
  readonly fetch: typeof fetch
  /** Where the cms group is mounted; default `/api/cms` (absolute outside the browser). */
  readonly baseUrl?: string
}

export type CmsClient = ReturnType<typeof createCmsClient>

export const createCmsClient = ({ fetch, baseUrl = '/api/cms' }: CmsClientOptions) => {
  const get = async <T>(path: string, query: Record<string, string | undefined> = {}) => {
    const search = new URLSearchParams(
      Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString()
    const url = `${baseUrl}${path}${search ? `?${search}` : ''}`
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new CmsRequestError(response.status, url)
    return (await response.json()) as T
  }
  const key = encodeURIComponent
  return {
    /** What a public path is: a page, an item, a redirect or not found (always a 200). */
    resolve: (path: string) => get<ResolveResult>('/resolve', { path }),
    /** Settings, menus and system page paths in a locale (default: the default locale). */
    site: (locale?: string) => get<PublicSite>('/site', { locale }),
    collection: (collection: string, q: CollectionQuery = {}) =>
      get<PublicItems>(`/collections/${key(collection)}`, {
        locale: q.locale,
        page: q.page?.toString(),
        perPage: q.perPage?.toString(),
        sort: q.sort,
        ref: q.ref,
        ids: q.ids?.join(','),
      }),
    /** A page's draft; needs an editor session (cms.pages.view). Never cached. */
    previewPage: (id: string, locale?: string) =>
      get<PagePreview>(`/pages/${key(id)}/preview`, { locale }),
    /** An item's draft; needs an editor session (cms.collections.view). Never cached. */
    previewItem: (id: string, locale?: string) =>
      get<ItemPreview>(`/items/${key(id)}/preview`, { locale }),
  }
}
