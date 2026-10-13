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
