import { readCacheControl } from '@opulonjs/cms/api'
import {
  type CmsEvent,
  cmsNitroPlugin,
  useCmsClient,
  useCmsPublicPage,
} from '@opulonjs/cms/site/nuxt'
import {
  createApp,
  createRouter,
  defineEventHandler,
  type H3Event,
  send,
  sendRedirect,
  sendStream,
  sendWebResponse,
  setResponseHeader,
  setResponseHeaders,
  toNodeListener,
} from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from '../../host/test/cms/helpers.ts'

// The cloudflare-module transport for real: an H3 app answered through node-mock-http's
// `fetchNodeRequestHandler` (Nitro's `localFetch`), which the preset's fetch handler calls for
// every request. The plugin runs on a NitroApp-shaped object as Nitro runs plugins.
const host = useCmsHost()

type Hook = (...args: never[]) => unknown
const hooks: Record<string, Hook> = {}
const nitro = {
  hooks: {
    hook: (name: string, fn: Hook) => {
      hooks[name] = fn
    },
  },
  localFetch: (input: string, init?: RequestInit) =>
    // As Nitro does (in JS): node-mock-http's request lacks only Node's `signal`, unused by H3.
    fetchNodeRequestHandler(
      toNodeListener(app) as unknown as Parameters<typeof fetchNodeRequestHandler>[0],
      input,
      init,
    ),
}

const call = <A extends unknown[]>(name: string, ...args: A) =>
  (hooks[name] as unknown as (...args: A) => unknown)(...args)

/** An opted-in page: renders with the cms, then Nitro's render:response sequence. */
const renderPage = defineEventHandler(async (event) => {
  const app = createSSRApp(
    defineComponent(async () => {
      useCmsPublicPage()
      const resolved = await useCmsClient().resolve('/promo')
      return () => h('p', JSON.stringify(resolved))
    }),
  )
  const html = await renderToString(app, { event })
  const response = { statusCode: 200, headers: {} as Record<string, string>, body: html }
  call('render:response', response, { event })
  setResponseHeaders(event, response.headers)
  return response.body
})

const router = createRouter()
  .get(
    '/send',
    defineEventHandler((e) => send(e, `hello ${e.headers.get('cookie')}`)),
  )
  .get(
    '/stream',
    defineEventHandler((e) => sendStream(e, new Blob(['streamed']).stream())),
  )
  .get(
    '/redirect',
    defineEventHandler((e) => sendRedirect(e, '/elsewhere')),
  )
  .get(
    '/web',
    defineEventHandler((e) => sendWebResponse(e, new Response('web'))),
  )
  .get(
    '/end',
    defineEventHandler((e) => {
      e.node.res.end('raw')
    }),
  )
  .get(
    '/return',
    defineEventHandler(() => 'returned'),
  )
  .get(
    '/host-send',
    defineEventHandler((e) => {
      setResponseHeader(e, 'cache-control', 'public, max-age=60')
      return send(e, 'public by the host')
    }),
  )
  .get(
    '/host-web',
    defineEventHandler((e) =>
      sendWebResponse(
        e,
        new Response('web', { headers: { 'cache-control': 'public, max-age=60' } }),
      ),
    ),
  )
  .get('/promo', renderPage)

const app = createApp({
  onRequest: (event: H3Event) => {
    const url = `https://example.com${event.path}`
    event.context.cloudflare = {
      request: new Request(url),
      env: host.env(),
      context: { waitUntil: () => {} },
    }
    call('request', event as unknown as CmsEvent)
  },
}).use(router)

cmsNitroPlugin(host.worker)(nitro)

const get = async (path: string) => {
  const response = await nitro.localFetch(path, { headers: { cookie: 'name=alice' } })
  await response.arrayBuffer()
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    cacheTag: response.headers.get('cache-tag'),
  }
}

test('every direct send without a Cache-Control goes out private, no-store', async () => {
  for (const path of ['/send', '/stream', '/redirect', '/web', '/end', '/return']) {
    expect({ path, ...(await get(path)) }).toMatchObject({
      path,
      cacheControl: 'private, no-store',
      cacheTag: null,
    })
  }
})

test("a host's own Cache-Control through those paths is kept", async () => {
  expect((await get('/host-send')).cacheControl).toBe('public, max-age=60')
  expect((await get('/host-web')).cacheControl).toBe('public, max-age=60')
})

test('an opted-in cms page is still public under its tags', async () => {
  const created = await host.create(
    page({ en: '/promo' }, [section('rich_text', { body: { en: '<p>Promo</p>' } })]),
  )
  await host.publish(created.body.id)
  const promo = await get('/promo')
  expect(promo.cacheControl).toBe(readCacheControl)
  expect(promo.cacheTag?.split(',')).toEqual(
    expect.arrayContaining(['cms', `cms:page:${created.body.id}`]),
  )
})
