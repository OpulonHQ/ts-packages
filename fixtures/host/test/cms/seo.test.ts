import type { Item, Page, PageLocale, ResolveResult } from '@opulonjs/cms/api'
import { buildHead, type PublicSite } from '@opulonjs/cms/site'
import { expect, test } from 'vitest'
import { locale, useCmsHost } from './helpers.ts'

const host = useCmsHost()

const read = <Body>(path: string) => host.call<Body>('GET', path, { as: null })
const resolve = (path: string) => read<ResolveResult>(`/resolve?path=${encodeURIComponent(path)}`)

const plain = { title: 'Offer', description: 'Our offer', image: null, noindex: false }
const jsonLd = '{"@context":"https://schema.org","@type":"Organization","name":"</script><b>"}'
const filled = {
  ...plain,
  keywords: 'notary, rome',
  canonical: 'https://example.test/offer',
  jsonLd,
}
const withSeo = (path: string, seo: PageLocale['seo']) => ({
  locales: { en: locale(path, { seo }) },
  sections: [],
})

test('a page drafts, publishes and keeps in revisions its keywords, canonical and JSON-LD', async () => {
  const created = await host.create(
    withSeo('/offer', { ...filled, keywords: '  notary, rome ', jsonLd: ` ${jsonLd} ` }),
  )
  expect(created.status).toBe(200)
  expect(created.body.draft.locales.en?.seo).toEqual(filled)
  expect(created.body.draft.locales.it?.seo).toEqual({
    title: '',
    description: '',
    image: null,
    noindex: false,
  })

  const published = (await host.publish(created.body.id)).body
  expect(published.status).toBe('published')
  expect(published.published?.locales.en?.seo).toEqual(filled)
  const revision = await host.call<{ document: Page['draft'] }>(
    'GET',
    `/pages/${created.body.id}/revisions/${published.publishedRevisionId}`,
  )
  expect(revision.body.document.locales.en?.seo).toEqual(filled)

  const resolved = (await resolve('/offer')).body
  expect(resolved).toMatchObject({ kind: 'page', seo: { ...filled, image: null } })

  await host.saveDraft('/settings', {
    data: { siteName: { en: 'Example' }, twitterHandle: 'example' },
  })
  await host.publishDraft('/settings')
  const site = (await read<PublicSite>('/site?locale=en')).body
  if (resolved.kind !== 'page') throw new Error('not a page')
  const head = buildHead(resolved, site, {
    origin: 'https://example.test',
    jsonLd: [{ '@type': 'FAQPage' }],
  })
  expect(head.script).toEqual([
    {
      type: 'application/ld+json',
      innerHTML:
        '{"@context":"https://schema.org","@type":"Organization","name":"\\u003c/script\\u003e\\u003cb\\u003e"}',
    },
    { type: 'application/ld+json', innerHTML: '{"@type":"FAQPage"}' },
  ])
  expect(head.meta).toContainEqual({ name: 'keywords', content: 'notary, rome' })
  expect(head.meta).toContainEqual({ name: 'twitter:site', content: '@example' })
  expect(head.link[0]).toEqual({ rel: 'canonical', href: 'https://example.test/offer' })

  const cleared = (await host.save(created.body.id, withSeo('/offer', { ...plain, keywords: ' ' })))
    .body
  expect(cleared.draft.locales.en?.seo).toEqual(plain)
})

test('a routed item carries the same SEO fields to the Read API', async () => {
  const created = await host.call<Item>('POST', '/collections/posts/items', {
    body: {
      locales: { en: locale('/blog/structured', { seo: filled }) },
      data: { title: { en: 'Structured' } },
    },
  })
  expect(created.status).toBe(200)
  expect(created.body.draft.locales.en?.seo).toEqual(filled)
  await host.publishDraft(`/items/${created.body.id}`)
  expect((await resolve('/blog/structured')).body).toMatchObject({
    kind: 'item',
    seo: { ...filled, image: null },
  })
})

test.for([
  {
    path: '/broken',
    given: '{"@type": "Thing"',
    message: 'The en structured data is not valid JSON.',
  },
  {
    path: '/scalar',
    given: '"text"',
    message: 'The en structured data must be a JSON object or array.',
  },
])('JSON-LD at $path is refused on save', async ({ path, given, message }) => {
  const refused = await host.create(withSeo(path, { ...plain, jsonLd: given }))
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ _tag: 'CmsInvalid', message })
})

test('a canonical URL is an http(s) URL or a site path', async () => {
  const refused = await host.create(
    withSeo('/canon', { ...plain, canonical: 'javascript:alert(1)' }),
  )
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({
    _tag: 'CmsInvalid',
    message: 'The en canonical URL must start with https:// or "/".',
  })
  for (const canonical of ['https://', 'http://[::1']) {
    const malformed = await host.create(withSeo('/canon', { ...plain, canonical }))
    expect(malformed.status).toBe(400)
    expect(malformed.body).toMatchObject({
      _tag: 'CmsInvalid',
      message: `The en canonical URL "${canonical}" is not a valid URL.`,
    })
  }
  const path = await host.create(withSeo('/canon', { ...plain, canonical: '/offer' }))
  expect(path.body.draft.locales.en?.seo.canonical).toBe('/offer')
})
