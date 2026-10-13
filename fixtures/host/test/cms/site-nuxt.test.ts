import { readCacheControl } from '@opulonjs/cms/api'
import type { CmsClient } from '@opulonjs/cms/site'
import {
  type CmsEvent,
  cmsNitroHooks,
  useCmsClient,
  useCmsPublicPage,
} from '@opulonjs/cms/site/nuxt'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

// Nitro is simulated: the event carries what nitropack's cloudflare-module preset puts on it
// (`context.cloudflare = { request, env, context }`), H3's response headers live in `sent`, and
// the hooks run in Nitro's order.
const host = useCmsHost()
const hooks = cmsNitroHooks(host.worker)

/** The headers H3's response holds (case-insensitive, like Node's). */
const h3Response = (sent: Headers) => ({
  getHeader: (name: string) => sent.get(name) ?? undefined,
  setHeader: (name: string, value: string) => sent.set(name, value),
  removeHeader: (name: string) => sent.delete(name),
})

const workersEvent = (url: string, env: unknown, sent: Headers, cookie?: string): CmsEvent => {
  const { pathname, search } = new URL(url)
  return {
    path: pathname + search,
    headers: new Headers(cookie ? { cookie } : {}),
    context: {
      cloudflare: { request: new Request(url), env, context: { waitUntil: () => {} } },
    },
    node: { res: h3Response(sent) },
  }
}

/** A request through the `request` hook; `sent` may hold a policy an earlier hook set. */
const request = (url: string, cookie?: string, sent = new Headers()) => {
  const event = workersEvent(url, host.env(), sent, cookie)
  hooks.request(event)
  return { event, sent }
}

/** Renders a page component during SSR of `event`; it opts in with `publicPage`. */
const render = async (event: CmsEvent, { publicPage = false } = {}) => {
  let client: CmsClient | undefined
  const app = createSSRApp(
    defineComponent(() => {
      if (publicPage) useCmsPublicPage()
      client = useCmsClient()
      return () => h('div')
    }),
  )
  await renderToString(app, { event })
  return client!
}

/**
 * What goes out for a rendered page, in Nitro's order: `render:response`, its headers set on H3's
 * response, then `beforeResponse`. `rendered: false` is any other handler (no render:response).
 */
const finish = (
  { event, sent }: { event: CmsEvent; sent: Headers },
  response: { statusCode?: number; headers?: Record<string, string>; body?: unknown } = {
    statusCode: 200,
  },
  { rendered = true, nitro = hooks } = {},
) => {
  if (rendered) {
    nitro.renderResponse(response, { event })
    for (const [name, value] of Object.entries(response.headers ?? {})) sent.set(name, value)
  }
  nitro.beforeResponse(event)
  return Object.fromEntries(sent)
}

const privateNoStore = { 'cache-control': 'private, no-store' }

test('an opted-in page reads in-process and its HTML gets the Read API policy and tag union', async () => {
  const created = await host.create(
    page({ en: '/about' }, [section('rich_text', { body: { en: '<p>Hi</p>' } })]),
  )
  await host.publish(created.body.id)

  const about = request('https://example.com/about')
  const cms = await render(about.event, { publicPage: true })
  expect(await cms.resolve('/about')).toMatchObject({ kind: 'page', id: created.body.id })
  await cms.site()

  const headers = finish(about)
  expect(headers['cache-control']).toBe(readCacheControl)
  expect(headers['cache-tag']?.split(',')).toEqual(
    expect.arrayContaining(['cms', `cms:page:${created.body.id}`, 'cms:site']),
  )
})

test('without the opt-in every answer is private, no-store and untagged, cms reads or not', async () => {
  // Public cms content plus the visitor's session: cms reads do not make the render public.
  const account = request('https://example.com/account', 'session=alice')
  await (await render(account.event)).resolve('/missing')
  expect(finish(account)).toEqual(privateNoStore)

  const plain = request('https://example.com/plain')
  await render(plain.event)
  expect(finish(plain)).toEqual(privateNoStore)

  // Any other handler (an API route, Nitro's own routes) without a policy of its own.
  expect(finish(request('https://example.com/_payload.json'), {}, { rendered: false })).toEqual(
    privateNoStore,
  )

  // An opted-in page that failed is not tagged either.
  const failed = request('https://example.com/missing')
  await (await render(failed.event, { publicPage: true })).resolve('/missing')
  expect(finish(failed, { statusCode: 500 })).toEqual(privateNoStore)
})

test('a policy the host or an earlier hook set is never replaced', async () => {
  // The exact value the hooks use as a default, set by the host on an opted-in cms page.
  const hostPrivate = request(
    'https://example.com/missing',
    undefined,
    new Headers({ 'cache-control': 'private, no-store, max-age=0' }),
  )
  await (await render(hostPrivate.event, { publicPage: true })).resolve('/missing')
  expect(finish(hostPrivate)).toEqual({ 'cache-control': 'private, no-store, max-age=0' })

  // An earlier hook's public policy on a page that did not opt in: kept, untagged.
  const earlier = request(
    'https://example.com/promo',
    undefined,
    new Headers({ 'cache-control': 'public, max-age=60' }),
  )
  await (await render(earlier.event)).resolve('/missing')
  expect(finish(earlier)).toEqual({ 'cache-control': 'public, max-age=60' })

  // A host policy in the render payload, in any case: kept; public and opted in, it is tagged.
  const mixed = request('https://example.com/missing')
  await (await render(mixed.event, { publicPage: true })).resolve('/missing')
  expect(
    finish(mixed, { statusCode: 200, headers: { 'Cache-Control': 'public, max-age=60' } }),
  ).toEqual({ 'cache-control': 'public, max-age=60', 'cache-tag': 'cms,cms:routes' })
})

test('?preview forwards the editor session to the cms and keeps even an opted-in page private', async () => {
  const created = await host.create(
    page({ en: '/draft' }, [section('rich_text', { body: { en: '<p>Draft</p>' } })]),
  )
  const cookie = await host.cookie()

  const preview = request('https://example.com/draft?preview', cookie)
  const cms = await render(preview.event, { publicPage: true })
  expect(await cms.previewPage(created.body.id)).toMatchObject({ path: '/draft' })
  await cms.resolve('/draft')
  expect(finish(preview)).toEqual(privateNoStore)

  // Without ?preview the session never reaches the cms, so drafts stay unreadable.
  const plain = request('https://example.com/draft', cookie)
  await expect((await render(plain.event)).previewPage(created.body.id)).rejects.toMatchObject({
    status: 401,
  })
})

test('outside ?preview, credentials passed to the cms fetch are dropped and an uncacheable read keeps an opted-in page private', async () => {
  const created = await host.create(
    page({ en: '/secret' }, [section('rich_text', { body: { en: '<p>Secret</p>' } })]),
  )
  const cookie = await host.cookie()

  const secret = request('https://example.com/secret')
  const draft = await secret.event.context.cms!.fetch(
    `https://example.com/api/cms/pages/${created.body.id}/preview?locale=en`,
    { headers: { cookie, authorization: 'Bearer x' } },
  )
  expect(draft.status).toBe(401)
  await (await render(secret.event, { publicPage: true })).site()

  expect(
    finish(secret, { statusCode: 200, headers: { 'cache-control': 'public, max-age=60' } }),
  ).toEqual(privateNoStore)
})

/** An opted-in render over a stub Worker answering every cms read with `answer()`. */
const stubbed = async (answer: () => Response, reads: Array<string>) => {
  const nitro = cmsNitroHooks({ fetch: async () => answer() })
  const sent = new Headers()
  const event = workersEvent('https://example.com/big', {}, sent)
  nitro.request(event)
  await render(event, { publicPage: true })
  for (const path of reads) await event.context.cms!.fetch(path)
  return finish({ event, sent }, { statusCode: 200 }, { nitro })
}

test('the HTML Cache-Tag union stays bounded: link tags collapse into cms:routes', async () => {
  // Two answers each under the bound whose union is not (as a page and the site can be).
  let call = 0
  const tags = (from: number) => [
    'cms',
    ...Array.from({ length: 150 }, (_, i) => `cms:page:${crypto.randomUUID()}-${from + i}`),
  ]
  const headers = await stubbed(
    () =>
      new Response('{}', {
        headers: { 'cache-control': readCacheControl, 'cache-tag': tags(call++ * 150).join(',') },
      }),
    ['/api/cms/resolve?path=%2Fbig', '/api/cms/site'],
  )
  const header = headers['cache-tag']!
  expect(new TextEncoder().encode(header).length).toBeLessThanOrEqual(8 * 1024)
  expect(header.split(',').sort()).toEqual(['cms', 'cms:routes'])
})

test('an HTML Cache-Tag union over the bound after collapsing is not edge-cached', async () => {
  // Collection tags do not collapse: 160 of them (one per list read) exceed 8 KiB.
  let call = 0
  const headers = await stubbed(
    () =>
      new Response('{}', {
        headers: {
          'cache-control': readCacheControl,
          'cache-tag': `cms,cms:collection:${'c'.repeat(40)}-${call++}`,
        },
      }),
    Array.from({ length: 160 }, () => '/api/cms/collections/x'),
  )
  expect(headers).toEqual(privateNoStore)
})

test('on Workers no page is streamed, so tags read late still go on its headers', async () => {
  const about = request('https://example.com/about')
  const route = { canStream: true, prefersStream: true }
  hooks.renderRoute(route, { event: about.event })
  expect(route.prefersStream).toBe(false)

  // Which pages read the cms is known only once they render: one without reads is not streamed
  // either.
  const plain = request('https://example.com/plain')
  const plainRoute = { canStream: true, prefersStream: true }
  hooks.renderRoute(plainRoute, { event: plain.event })
  expect(plainRoute.prefersStream).toBe(false)

  // Off Workers there is no in-process cms, and the host's streaming stays.
  const offWorkers: CmsEvent = { path: '/', headers: new Headers(), context: {} }
  hooks.request(offWorkers)
  const offRoute = { canStream: true, prefersStream: true }
  hooks.renderRoute(offRoute, { event: offWorkers })
  expect(offRoute.prefersStream).toBe(true)
})

test('a streamed page is not edge-cached: reads after the headers went out are not in its tags', async () => {
  const streamed = request('https://example.com/streamed')
  // A tag the host set on H3's response already, in any case.
  streamed.sent.set('Cache-Tag', 'cms,cms:site')
  await (await render(streamed.event, { publicPage: true })).site()
  expect(
    finish(streamed, {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, s-maxage=60', 'Cache-Tag': 'cms,cms:site' },
      body: new ReadableStream(),
    }),
  ).toEqual(privateNoStore)
})

test('?preview forwards the session only to the page origin', async () => {
  const created = await host.create(
    page({ en: '/elsewhere' }, [section('rich_text', { body: { en: '<p>Draft</p>' } })]),
  )
  const cookie = await host.cookie()
  const { event } = request('https://example.com/elsewhere?preview', cookie)
  const path = `/api/cms/pages/${created.body.id}/preview?locale=en`
  expect((await event.context.cms!.fetch(path)).status).toBe(200)
  expect((await event.context.cms!.fetch(`https://evil.example${path}`)).status).toBe(401)
})

test('outside Workers (no cloudflare context) nothing is installed or added', () => {
  const sent = new Headers()
  const event: CmsEvent = {
    path: '/',
    headers: new Headers(),
    context: {},
    node: { res: h3Response(sent) },
  }
  hooks.request(event)
  expect(event.context.cms).toBeUndefined()
  expect(finish({ event, sent })).toEqual({})
})
