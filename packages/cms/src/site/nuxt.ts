// @opulonjs/cms/site/nuxt: the Nuxt-on-Workers glue of the public site (TSPACK-19 decision 4,
// ADR 0004). It imports nothing from Nuxt: the server half is two Nitro runtime hooks over the
// H3 event (nitropack 2, cloudflare-module preset), the app half reads that event from Vue's
// SSR context, which Nuxt fills with `{ event }`.
import { useSSRContext } from 'vue'
import { cacheTagHeader, readCacheControl } from '../public.ts'
import { type CmsClient, createCmsClient } from './client.ts'

/** The host's Worker (`createWorker(...)`, or the host's wrapper of it). */
export interface CmsWorker<Env> {
  fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response>
}

/** What `cmsNitroHooks` keeps on `event.context.cms` for one SSR request. */
export interface CmsRequestContext {
  /** Dispatches to the Worker in-process and records each answer's Cache-Tag. */
  readonly fetch: typeof fetch
  /** The union of the Cache-Tags of every cms answer read for this page. */
  readonly tags: Set<string>
  /** The page was requested with `?preview`: the session is forwarded, the HTML not cached. */
  readonly preview: boolean
  /** Some cms answer read for this page was not publicly cacheable: the HTML is not cached. */
  uncacheable: boolean
}

/** The parts of an H3 event the hooks use (nitropack 2 on the cloudflare-module preset). */
export interface CmsEvent {
  readonly path: string
  readonly headers: Headers
  readonly context: {
    cloudflare?: {
      readonly request?: Request
      readonly env: unknown
      readonly context: { waitUntil(promise: Promise<unknown>): void }
    }
    cms?: CmsRequestContext
    // H3's context shares none of the optional keys above until set, so without this TypeScript
    // rejects the hooks in a Nuxt app as having "no properties in common" (a weak type).
    [key: string]: unknown
  }
  readonly node?: {
    readonly res?: {
      getHeader(name: string): unknown
      setHeader(name: string, value: string): unknown
      removeHeader(name: string): void
    }
  }
}

/** Nitro's `render:response` payload. */
export interface CmsRenderResponse {
  statusCode?: number
  headers?: Record<string, string>
  /** A `ReadableStream` when Nuxt streamed the page (`experimental.ssrStreaming`). */
  body?: unknown
}

/** Nuxt's `render:route` context (Nuxt 4 with `experimental.ssrStreaming`). */
export interface CmsRenderRoute {
  prefersStream: boolean
}

const cachingHeader = /^(cache-control|cache-tag)$/i

/**
 * Every answer's Cache-Control on Workers until a public cms page or the host sets one: Workers
 * Cache keys by URL alone and keeps a 200 without Cache-Control for two hours, so a page
 * personalized from a cookie would be served to every visitor. (Nitro's error handler replaces it
 * with `no-cache`, which Workers Cache revalidates with the Worker every time.) Spelled apart
 * from a host's own `private, no-store` so that one is never taken for the default and opened.
 */
const notCached = 'private, no-store, max-age=0'

/**
 * Nitro runtime hooks for a public site on Workers. `request` gives every request an in-process
 * cms fetch (no subrequest; the request's own env and ctx) and starts its answer as
 * `private, no-store, max-age=0` for Workers Cache; `renderResponse` copies the
 * Cache-Tags the page read onto its HTML with the Read API's `s-maxage` (a Cache-Control the host
 * set is kept), or, for `?preview`, when a cms answer was not publicly cacheable or when the page was
 * streamed, answers `private, no-store` without tags. A streamed page sends its headers before its
 * reads finish, and which pages read the cms is known only once they render, so `renderRoute`
 * (Nuxt's `render:route`) turns streaming off for every page on Workers, cms reads or not. Only
 * `?preview` requests forward the visitor's cookie, and only to the page's own origin
 * (credentials the page passes itself are dropped), so a draft is never read for a cacheable page.
 *
 * ```ts
 * // server/plugins/cms.ts
 * export default defineNitroPlugin((nitro) => {
 *   const cms = cmsNitroHooks(worker)
 *   nitro.hooks.hook('request', cms.request)
 *   nitro.hooks.hook('render:response', cms.renderResponse)
 *   nitro.hooks.hook('render:route', cms.renderRoute)
 * })
 * ```
 */
export const cmsNitroHooks = <Env>(worker: CmsWorker<Env>) => ({
  request: (event: CmsEvent) => {
    const cloudflare = event.context.cloudflare
    // Not on Workers (e.g. `nuxt dev` without the Cloudflare dev proxy): no in-process path.
    if (!cloudflare) return
    const url = new URL(
      event.path,
      cloudflare.request?.url ?? `http://${event.headers.get('host')}`,
    )
    const preview = url.searchParams.has('preview')
    const cookie = event.headers.get('cookie')
    const tags = new Set<string>()
    const fetch: typeof globalThis.fetch = async (input, init) => {
      // The public origin: sitemap answers build their URLs from the request's.
      const request = new Request(new URL(input instanceof Request ? input.url : input, url), init)
      // Credentials reach the cms only for `?preview`, whatever the caller passed: a cacheable
      // page must never be rendered from a session's (draft or permissioned) reads.
      request.headers.delete('cookie')
      request.headers.delete('authorization')
      // Only to the page's own origin: a session never leaves with a read meant for elsewhere.
      if (preview && cookie && new URL(request.url).origin === url.origin) {
        request.headers.set('cookie', cookie)
      }
      // The env is the Worker's own (`cloudflare.env`); the host types it through `worker`.
      const response = await worker.fetch(request, cloudflare.env as Env, cloudflare.context)
      // Only publicly cacheable answers may end up in cached HTML; anything else (an error, a
      // private read) keeps this page out of the shared cache.
      if (!/\bpublic\b/.test(response.headers.get('cache-control') ?? '')) {
        context.uncacheable = true
      }
      for (const tag of response.headers.get('cache-tag')?.split(',') ?? []) {
        if (tag.trim()) tags.add(tag.trim())
      }
      return response
    }
    const context: CmsRequestContext = { fetch, tags, preview, uncacheable: false }
    event.context.cms = context
    // Set first, so the host's policies (route rules, its handlers) and the cms's replace it, and
    // so it holds for Nitro's error answers, which skip render:response.
    event.node?.res?.setHeader('cache-control', notCached)
  },
  renderResponse: (response: CmsRenderResponse, { event }: { event: CmsEvent }) => {
    const cms = event.context.cms
    if (!cms) return
    // A union too large for one Cache-Tag header could not be purged: not edge-cached either.
    const tag = cacheTagHeader(cms.tags)
    // A streamed body left before the page finished reading: its tags would be incomplete.
    const streamed = response.body instanceof ReadableStream
    if (cms.preview || cms.uncacheable || streamed || tag === undefined) {
      // Header names in any case, on the hook's headers and on those H3 already holds.
      response.headers = Object.fromEntries(
        Object.entries(response.headers ?? {}).filter(([name]) => !cachingHeader.test(name)),
      )
      response.headers['cache-control'] = 'private, no-store'
      event.node?.res?.removeHeader('cache-tag')
      return
    }
    if (cms.tags.size === 0 || (response.statusCode ?? 200) >= 500) return
    const headers = (response.headers ??= {})
    headers['cache-tag'] = tag
    const sent = event.node?.res?.getHeader('cache-control')
    const hostPolicy =
      Object.keys(headers).some((name) => /^cache-control$/i.test(name)) ||
      (sent !== undefined && sent !== notCached)
    if (!hostPolicy) {
      headers['cache-control'] = readCacheControl
    }
  },
  // Every page `request` equipped (all of them on Workers): reads happen during the render.
  renderRoute: (route: CmsRenderRoute, { event }: { event: CmsEvent }) => {
    if (event.context.cms) route.prefersStream = false
  },
})

/**
 * The cms client for a component's setup: during SSR on Workers it reads in-process through
 * `cmsNitroHooks`; in the browser (and on servers without it) it uses the real `fetch`, so pass
 * an absolute `baseUrl` there.
 */
export const useCmsClient = (options: { baseUrl?: string } = {}): CmsClient => {
  // `in`, not `typeof window`: also typechecks in server code without the DOM lib (Nitro's).
  const ssr = !('window' in globalThis)
    ? (useSSRContext<{ event?: CmsEvent }>()?.event?.context.cms ?? undefined)
    : undefined
  return createCmsClient({
    fetch: ssr?.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    ...options,
  })
}
