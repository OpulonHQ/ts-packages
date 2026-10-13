import { sitemapSource } from '@opulonjs/cms/server'
import { cms } from '@opulonjs/cms/server'
import { composeServer, core, CompositionError, defineModule } from '@opulonjs/core'
import { media } from '@opulonjs/media/server'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { definitions } from '../../cms/definitions.ts'
import { locale, page, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const read = (path: string) => host.call<string>('GET', path, { as: null })
/** The sitemap XML as text (the helper parses JSON, so read the raw response). */
const xml = async (path: string) => {
  const response = await host.fetch(`https://host.test/api/cms${path}`)
  return { status: response.status, headers: response.headers, text: await response.text() }
}

test('the sitemap index lists one child per source: cms pages, routed collections and host modules', async () => {
  const about = await host.create(page({ en: '/about', it: '/chi-siamo' }))
  await host.publish(about.body.id)
  const hidden = await host.create({
    locales: {
      en: locale('/hidden', { seo: { title: '', description: '', image: null, noindex: true } }),
    },
    sections: [],
  })
  await host.publish(hidden.body.id)
  await host.create(page({ en: '/draft' }))

  const index = await xml('/sitemap.xml')
  expect(index.status).toBe(200)
  expect(index.headers.get('content-type')).toMatch(/^application\/xml/)
  expect(index.headers.get('cache-tag')).toBe('cms,cms:routes')
  const locs = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  // Collections that are not routed (categories, testimonials) have no sitemap.
  expect(locs).toEqual([
    'https://host.test/sitemaps/cms.pages.xml',
    'https://host.test/sitemaps/cms.posts.xml',
    'https://host.test/sitemaps/demo.notes.xml',
  ])
  expect(index.text).toMatch(/<sitemap><loc>[^<]+cms\.pages\.xml<\/loc><lastmod>20\d\d-/)

  const pages = await xml('/sitemaps/cms.pages.xml')
  expect(pages.status).toBe(200)
  // Published, available and indexable only: no draft, no noindex page.
  expect(pages.text).not.toContain('/hidden')
  expect(pages.text).not.toContain('/draft')
  const urls = [...pages.text.matchAll(/<url>(.*?)<\/url>/g)].map((m) => m[1])
  expect(urls).toHaveLength(2)
  expect(urls[0]).toMatch(
    /^<loc>https:\/\/host\.test\/about<\/loc><lastmod>20\d\d-[^<]+<\/lastmod>/,
  )
  expect(urls[0]).toContain(
    '<xhtml:link rel="alternate" hreflang="en" href="https://host.test/about"/>' +
      '<xhtml:link rel="alternate" hreflang="it" href="https://host.test/it/chi-siamo"/>' +
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://host.test/about"/>',
  )
  expect(urls[1]).toMatch(/^<loc>https:\/\/host\.test\/it\/chi-siamo<\/loc>/)

  const notes = await xml('/sitemaps/demo.notes.xml')
  expect(notes.text).toContain('<url><loc>https://host.test/notes/1</loc></url>')
  expect((await read('/sitemaps/nope.xml')).status).toBe(404)
})

test('sitemap sources are checked like other contributions', () => {
  const source = (key: string) => sitemapSource({ key, list: Effect.succeed([]) })
  const shop = (keys: ReadonlyArray<string>, dependsOn = ['cms']) =>
    defineModule({
      id: 'shop',
      dependsOn,
      groups: [],
      handlers: () => Layer.empty,
      contributes: keys.map(source),
    })
  const modules = (m: ReturnType<typeof shop>) => [core(), media(), cms({ definitions }), m]
  const fails = (m: ReturnType<typeof shop>, message: RegExp) =>
    expect(() => composeServer({ modules: modules(m) })).toThrow(
      expect.objectContaining({
        name: CompositionError.name,
        message: expect.stringMatching(message),
      }),
    )
  expect(() => composeServer({ modules: modules(shop(['shop.products'])) })).not.toThrow()
  fails(shop(['shop.a', 'shop.a']), /shop: duplicate sitemapSource "shop.a"/)
  fails(shop(['cms.pages']), /shop: sitemapSource "cms.pages" is outside the module prefix/)
  fails(shop(['shop.a'], []), /shop: contributes sitemapSource "shop.a", so it must list "cms"/)
})
