import {
  buildHead,
  type PublicSite,
  type ResolvedMedia,
  type ResolvedPage,
} from '@opulonjs/cms/site'
import { expect, test } from 'vitest'

const image = (id: string): ResolvedMedia => ({
  id,
  url: `/media/${id}/1/x.png`,
  alt: 'A view',
  caption: null,
  width: 1200,
  height: 630,
  mime: 'image/png',
  srcset: '',
})

const site = (settings: PublicSite['settings'] = {}): PublicSite => ({
  locale: 'it',
  locales: ['en', 'it'],
  settings: { siteName: 'Example', titleTemplate: '%s | Example', defaultImage: null, ...settings },
  menus: {},
  systemPages: {},
})

const page = (seo: Partial<ResolvedPage['seo']> = {}): ResolvedPage => ({
  kind: 'page',
  id: 'p1',
  locale: 'it',
  path: '/it/chi-siamo',
  alternates: [
    { locale: 'en', path: '/about' },
    { locale: 'it', path: '/it/chi-siamo' },
  ],
  seo: { title: 'Chi siamo', description: 'Su di noi', image: null, noindex: false, ...seo },
  publishedAt: '2026-10-13T00:00:00.000Z',
  systemKey: null,
  sections: [],
})

const origin = 'https://example.com'

test('title template, description, OG, canonical and hreflang with x-default', () => {
  expect(buildHead(page({ image: image('m1') }), site(), { origin })).toEqual({
    title: 'Chi siamo | Example',
    htmlAttrs: { lang: 'it' },
    meta: [
      { name: 'description', content: 'Su di noi' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Chi siamo | Example' },
      { property: 'og:description', content: 'Su di noi' },
      { property: 'og:url', content: 'https://example.com/it/chi-siamo' },
      { property: 'og:site_name', content: 'Example' },
      { property: 'og:image', content: 'https://example.com/media/m1/1/x.png' },
      { property: 'og:image:alt', content: 'A view' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
    ],
    link: [
      { rel: 'canonical', href: 'https://example.com/it/chi-siamo' },
      { rel: 'alternate', hreflang: 'en', href: 'https://example.com/about' },
      { rel: 'alternate', hreflang: 'it', href: 'https://example.com/it/chi-siamo' },
      { rel: 'alternate', hreflang: 'x-default', href: 'https://example.com/about' },
    ],
  })
})

test('noindex, the default image as fallback, and the site name for an untitled page', () => {
  const head = buildHead(
    page({ title: '', description: '', noindex: true }),
    site({ defaultImage: image('d1') }),
    { origin },
  )
  expect(head.title).toBe('Example')
  expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex' })
  expect(head.meta).toContainEqual({
    property: 'og:image',
    content: 'https://example.com/media/d1/1/x.png',
  })
  expect(head.meta.some((m) => m.name === 'description')).toBe(false)
})

test('no template keeps the title; no default-locale alternate means no x-default', () => {
  const only = { ...page(), alternates: [{ locale: 'it', path: '/it/chi-siamo' }] }
  const head = buildHead(only, site({ titleTemplate: '' }), { origin })
  expect(head.title).toBe('Chi siamo')
  expect(head.link.map((l) => l.hreflang)).toEqual([undefined, 'it'])
})

test('a page that sets none of the new fields renders the head as before', () => {
  expect(
    JSON.stringify(
      buildHead(page({ image: image('m1') }), site({ twitterHandle: '' }), { origin }),
    ),
  ).toBe(
    '{"title":"Chi siamo | Example","htmlAttrs":{"lang":"it"},"meta":[' +
      '{"name":"description","content":"Su di noi"},' +
      '{"property":"og:type","content":"website"},' +
      '{"property":"og:title","content":"Chi siamo | Example"},' +
      '{"property":"og:description","content":"Su di noi"},' +
      '{"property":"og:url","content":"https://example.com/it/chi-siamo"},' +
      '{"property":"og:site_name","content":"Example"},' +
      '{"property":"og:image","content":"https://example.com/media/m1/1/x.png"},' +
      '{"property":"og:image:alt","content":"A view"},' +
      '{"property":"og:image:width","content":"1200"},' +
      '{"property":"og:image:height","content":"630"}],"link":[' +
      '{"rel":"canonical","href":"https://example.com/it/chi-siamo"},' +
      '{"rel":"alternate","hreflang":"en","href":"https://example.com/about"},' +
      '{"rel":"alternate","hreflang":"it","href":"https://example.com/it/chi-siamo"},' +
      '{"rel":"alternate","hreflang":"x-default","href":"https://example.com/about"}]}',
  )
})

test('JSON-LD from the editor and the host is escaped so it cannot close its script tag', () => {
  const head = buildHead(
    page({ jsonLd: '{"name":"</script><script>alert(1)</script>","note":"a & b\u2028c\u2029"}' }),
    site(),
    { origin, jsonLd: [{ '@type': 'FAQPage', name: '</script>' }] },
  )
  expect(head.script).toEqual([
    {
      type: 'application/ld+json',
      innerHTML:
        '{"name":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e","note":"a \\u0026 b\\u2028c\\u2029"}',
    },
    {
      type: 'application/ld+json',
      innerHTML: '{"@type":"FAQPage","name":"\\u003c/script\\u003e"}',
    },
  ])
  for (const { innerHTML } of head.script!) {
    expect(innerHTML).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(innerHTML)).toBeTypeOf('object')
  }
})

test('keywords become a meta tag; a canonical override replaces the canonical and og:url', () => {
  const head = buildHead(page({ keywords: 'notaio, roma', canonical: '/it/originale' }), site(), {
    origin,
  })
  expect(head.meta).toContainEqual({ name: 'keywords', content: 'notaio, roma' })
  expect(head.meta).toContainEqual({
    property: 'og:url',
    content: 'https://example.com/it/originale',
  })
  expect(head.link).toEqual([
    { rel: 'canonical', href: 'https://example.com/it/originale' },
    { rel: 'alternate', hreflang: 'en', href: 'https://example.com/about' },
    { rel: 'alternate', hreflang: 'it', href: 'https://example.com/it/chi-siamo' },
    { rel: 'alternate', hreflang: 'x-default', href: 'https://example.com/about' },
  ])
  expect(
    buildHead(page({ canonical: 'https://other.example/x' }), site(), { origin }).link[0],
  ).toEqual({ rel: 'canonical', href: 'https://other.example/x' })
})

test('Twitter card tags come from the SEO fields and the stored handle', () => {
  const twitter = (head: ReturnType<typeof buildHead>) =>
    head.meta.filter((m) => m.name?.startsWith('twitter:'))
  expect(
    twitter(
      buildHead(page({ image: image('m1') }), site({ twitterHandle: 'example' }), { origin }),
    ),
  ).toEqual([
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:site', content: '@example' },
    { name: 'twitter:title', content: 'Chi siamo | Example' },
    { name: 'twitter:description', content: 'Su di noi' },
    { name: 'twitter:image', content: 'https://example.com/media/m1/1/x.png' },
  ])
  expect(
    twitter(buildHead(page({ description: '' }), site({ twitterHandle: '@example' }), { origin })),
  ).toEqual([
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:site', content: '@example' },
    { name: 'twitter:title', content: 'Chi siamo | Example' },
  ])
  expect(twitter(buildHead(page(), site(), { origin }))).toEqual([])
})
