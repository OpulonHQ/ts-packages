import { readCacheControl } from '@opulonjs/cms/api'
import type { CmsClient } from '@opulonjs/cms/site'
import { type CmsEvent, cmsNitroHooks, useCmsClient } from '@opulonjs/cms/site/nuxt'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

// Nitro is simulated: the event carries what nitropack's cloudflare-module preset puts on it
// (`context.cloudflare = { request, env, context }`), and the hooks run as Nitro calls them.
const host = useCmsHost()
const hooks = cmsNitroHooks(host.worker)

const request = (url: string, cookie?: string) => {
  const pending: Array<Promise<unknown>> = []
  const { pathname, search } = new URL(url)
  const event: CmsEvent = {
    path: pathname + search,
    headers: new Headers(cookie ? { cookie } : {}),
    context: {
      cloudflare: {
        request: new Request(url),
        env: host.env(),
        context: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
      },
    },
  }
  hooks.request(event)
  return { event, settled: () => Promise.all(pending) }
}

/** The client a Vue component gets during SSR of `event`, as a page's setup sees it. */
const ssrClient = async (event: CmsEvent) => {
  let client: CmsClient | undefined
  const app = createSSRApp(
    defineComponent(() => {
      client = useCmsClient()
      return () => h('div')
    }),
  )
  await renderToString(app, { event })
  return client!
}

const respond = (
  event: CmsEvent,
  response: { statusCode?: number; headers?: Record<string, string> } = {},
) => {
  hooks.renderResponse(response, { event })
  return response.headers ?? {}
}

test('SSR reads in-process and the HTML gets the union of the Read API cache tags', async () => {
  const created = await host.create(
    page({ en: '/about' }, [section('rich_text', { body: { en: '<p>Hi</p>' } })]),
  )
  await host.publish(created.body.id)

  const { event, settled } = request('https://example.com/about')
  const cms = await ssrClient(event)
  expect(await cms.resolve('/about')).toMatchObject({ kind: 'page', id: created.body.id })
  await cms.site()
  await settled()

  const headers = respond(event, { statusCode: 200, headers: { 'content-type': 'text/html' } })
  expect(headers['cache-control']).toBe(readCacheControl)
  expect(headers['cache-tag']?.split(',')).toEqual(
    expect.arrayContaining(['cms', `cms:page:${created.body.id}`, 'cms:site']),
  )
})

test('a host cache policy is kept; error pages and pages without cms reads are left alone', async () => {
  const kept = request('https://example.com/missing')
  await (await ssrClient(kept.event)).resolve('/missing')
  expect(respond(kept.event, { headers: { 'cache-control': 'private' } })).toEqual({
    'cache-control': 'private',
    'cache-tag': 'cms,cms:routes',
  })

  const failed = request('https://example.com/missing')
  await (await ssrClient(failed.event)).resolve('/missing')
  expect(respond(failed.event, { statusCode: 500 })).toEqual({})

  expect(respond(request('https://example.com/plain').event, { statusCode: 200 })).toEqual({})
})

test('?preview forwards the editor session to the cms and makes the HTML private, untagged', async () => {
  const created = await host.create(
    page({ en: '/draft' }, [section('rich_text', { body: { en: '<p>Draft</p>' } })]),
  )
  const cookie = await host.cookie()

  const preview = request('https://example.com/draft?preview', cookie)
  const cms = await ssrClient(preview.event)
  expect(await cms.previewPage(created.body.id)).toMatchObject({ path: '/draft' })
  await cms.resolve('/draft')
  expect(respond(preview.event, { statusCode: 200 })).toEqual({
    'cache-control': 'private, no-store',
  })

  // Without ?preview the session never reaches the cms, so drafts stay unreadable.
  const plain = request('https://example.com/draft', cookie)
  await expect((await ssrClient(plain.event)).previewPage(created.body.id)).rejects.toMatchObject({
    status: 401,
  })
})

test('outside ?preview, credentials passed to the cms fetch are dropped and an uncacheable read keeps the HTML private', async () => {
  const created = await host.create(
    page({ en: '/secret' }, [section('rich_text', { body: { en: '<p>Secret</p>' } })]),
  )
  const cookie = await host.cookie()

  const { event, settled } = request('https://example.com/secret')
  const draft = await event.context.cms!.fetch(
    `https://example.com/api/cms/pages/${created.body.id}/preview?locale=en`,
    { headers: { cookie, authorization: 'Bearer x' } },
  )
  expect(draft.status).toBe(401)
  await (await ssrClient(event)).site()
  await settled()

  expect(
    respond(event, { statusCode: 200, headers: { 'cache-control': 'public, max-age=60' } }),
  ).toEqual({ 'cache-control': 'private, no-store' })
})

test('outside Workers (no cloudflare context) nothing is installed or added', () => {
  const event: CmsEvent = { path: '/', headers: new Headers(), context: {} }
  hooks.request(event)
  expect(event.context.cms).toBeUndefined()
  expect(respond(event, { statusCode: 200 })).toEqual({})
})
