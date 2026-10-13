import { Effect } from 'effect'
import { expect, test } from 'vitest'
import type { SitemapEntry } from '../src/server/sitemap.ts'
import { sitemapXml } from '../src/server/sitemap-xml.ts'

const origin = 'https://host.test'
const xml = sitemapXml(origin, ['en', 'it'])
const locs = (body: string) => [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
const escaped = (path: string) => encodeURI(`${origin}${path}`).replaceAll('&', '&amp;')
const files = (entries: ReadonlyArray<SitemapEntry>) =>
  Effect.runSync(xml.files('bulk.pages', entries))
const verify = (entries: ReadonlyArray<SitemapEntry>) => {
  const children = files(entries)
  const actual: string[] = []
  for (const child of children) {
    const body = xml.body(child.entries)
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(50_000_000)
    const urls = locs(body)
    expect(urls.length).toBeLessThanOrEqual(50_000)
    actual.push(...urls)
  }
  expect(actual).toEqual(entries.map((e) => escaped(e.path)))
  expect(files(entries).map((f) => f.name)).toEqual(children.map((f) => f.name))
  return children
}

test.each([0, 50_000, 50_001])('serialized sitemap covers the count boundary %i', (count) => {
  const entries = Array.from({ length: count }, (_, i) => ({ path: `/count/${i}` }))
  expect(verify(entries).map((f) => f.name)).toEqual(
    count <= 50_000 ? ['bulk.pages.xml'] : ['bulk.pages-1.xml', 'bulk.pages-2.xml'],
  )
})

test('escaped XML and alternate links force a byte split below 50,000 URLs', () => {
  const entries = Array.from({ length: 40_000 }, (_, i): SitemapEntry => {
    const path = `/escaped/${i}/${'é&'.repeat(40)}`
    return { path, lastmod: '2026-10-01T00:00:00Z', alternates: [{ locale: 'en', path }] }
  })
  expect(Buffer.byteLength(xml.body(entries))).toBeGreaterThan(50_000_000)
  const children = verify(entries)
  expect(children).toHaveLength(2)
  expect(children[0]!.entries.length).toBeLessThan(50_000)
  expect(children.map((f) => f.name)).toEqual(['bulk.pages-1.xml', 'bulk.pages-2.xml'])
})

test.each([-1, 0, 1])('serialized sitemap splits at the byte cap %+i', (delta) => {
  const wrapperBytes = Buffer.byteLength(xml.body([]))
  const entry = (i: number, padding: number): SitemapEntry => ({
    path: `/boundary/${String(i).padStart(5, '0')}/&é${'x'.repeat(padding)}`,
    lastmod: '2026-10-01T00:00:00Z',
  })
  const entryBytes = Buffer.byteLength(xml.body([entry(0, 0)])) - wrapperBytes
  const width = Math.floor((50_000_000 - wrapperBytes) / 50_000)
  const remainder = 50_000_000 - wrapperBytes - width * 50_000 + delta
  const entries = Array.from({ length: 50_000 }, (_, i) =>
    entry(i, width - entryBytes + (i < remainder ? 1 : 0)),
  )
  expect(Buffer.byteLength(xml.body(entries))).toBe(50_000_000 + delta)
  const children = verify(entries)
  expect(children.map((f) => f.name)).toEqual(
    delta <= 0 ? ['bulk.pages.xml'] : ['bulk.pages-1.xml', 'bulk.pages-2.xml'],
  )
  expect(children.reduce((bytes, f) => bytes + Buffer.byteLength(xml.body(f.entries)), 0)).toBe(
    50_000_000 + delta + (children.length - 1) * wrapperBytes,
  )
})

test('an entry larger than a whole sitemap fails instead of producing invalid XML', () => {
  expect(() => files([{ path: `/oversized/${'x'.repeat(50_000_000)}` }])).toThrow(
    /Sitemap entry exceeds byte limit: bulk.pages/,
  )
})
