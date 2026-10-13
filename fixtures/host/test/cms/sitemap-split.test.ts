import { type SitemapEntry, sitemapSource } from '@opulonjs/cms/server'
import { composeServer, defineModule } from '@opulonjs/core'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { server } from '../../server/opulon.ts'
import { useCmsHost } from './helpers.ts'

const host = useCmsHost()
const origin = 'https://host.test'
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
const escaped = (path: string) => encodeURI(`${origin}${path}`).replaceAll('&', '&amp;')
let boundaryEntries: ReadonlyArray<SitemapEntry> = []
const boundary = useCmsHost(
  composeServer({
    modules: [
      ...server.modules,
      defineModule({
        id: 'bulk',
        dependsOn: ['cms'],
        groups: [],
        handlers: () => Layer.empty,
        contributes: [
          sitemapSource({ key: 'bulk.boundary', list: Effect.sync(() => boundaryEntries) }),
        ],
      }),
    ],
    contentLocales: ['en', 'it'],
  }),
)

test.each([
  { name: 'count boundary', count: 50_000, suffix: '', split: false },
  { name: 'count split', count: 50_001, suffix: '', split: true },
  { name: 'escaped XML byte split', count: 50_001, suffix: 'é&'.repeat(40), split: true },
])(
  'cms pages sitemap preserves every URL at the $name',
  async ({ count, suffix, split }) => {
    await host.query('delete from cms.document')
    await host.query(`
    with seeded as (
      insert into cms.document (id, kind, draft, published, published_at)
      select gen_random_uuid(), 'page', '{}', '{"locales":{"en":{"seo":{"noindex":false}}}}',
        '2026-10-01T00:00:00Z'::timestamptz + n * interval '1 second'
      from generate_series(1, ${count}) n
      returning id, published_at
    )
    insert into cms.path (locale, path, document_id)
    select 'en', '/split/' || extract(epoch from published_at - '2026-10-01T00:00:00Z'::timestamptz)::int || '/${suffix}', id
    from seeded
  `)
    const readIndex = async () => {
      const response = await host.publicFetch(`${origin}/api/cms/sitemap.xml`)
      expect(response.status).toBe(200)
      return locs(await response.text()).filter((loc) => loc.includes('/cms.pages'))
    }
    const children = await readIndex()
    expect(children.length).toBeGreaterThanOrEqual(split ? 2 : 1)
    if (!split) expect(children).toEqual([`${origin}/api/cms/sitemaps/cms.pages.xml`])
    else
      children.forEach((loc, i) =>
        expect(loc).toBe(`${origin}/api/cms/sitemaps/cms.pages-${i + 1}.xml`),
      )
    expect(await readIndex()).toEqual(children)
    const actual: string[] = []
    for (const child of children) {
      const response = await host.publicFetch(child)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toMatch(/^application\/xml/)
      const body = await response.text()
      expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(50_000_000)
      const urls = locs(body)
      expect(urls.length).toBeGreaterThan(0)
      expect(urls.length).toBeLessThanOrEqual(50_000)
      actual.push(...urls)
    }
    expect(actual).toHaveLength(count)
    expect(new Set(actual)).toEqual(
      new Set(Array.from({ length: count }, (_, i) => escaped(`/split/${i + 1}/${suffix}`))),
    )
    expect(
      (await host.publicFetch(`${origin}/api/cms/sitemaps/cms.pages-${children.length + 1}.xml`))
        .status,
    ).toBe(404)
    if (process.env.SITEMAP_TIMINGS === '1' && count > 50_000) {
      const samples = []
      for (let run = 0; run < 5; run++) {
        for (const path of ['/api/cms/sitemap.xml', new URL(children[0]!).pathname]) {
          const cpu = process.cpuUsage()
          const start = performance.now()
          const response = await host.publicFetch(`${origin}${path}`)
          const body = await response.text()
          const wallMs = performance.now() - start
          const used = process.cpuUsage(cpu)
          expect(response.status).toBe(200)
          expect(locs(body).length).toBeGreaterThan(0)
          samples.push({
            path,
            wallMs,
            cpuMs: (used.user + used.system) / 1000,
            bytes: Buffer.byteLength(body),
          })
        }
      }
      console.log(JSON.stringify({ count, suffix, samples }))
    }
  },
  60_000,
)

test.each([-1, 0, 1])(
  'serialized sitemap splits at the byte cap %+i',
  async (delta) => {
    const read = async (name: string) => {
      const response = await boundary.publicFetch(`${origin}/api/cms/sitemaps/${name}`)
      expect(response.status).toBe(200)
      return response.text()
    }
    boundaryEntries = []
    const wrapperBytes = Buffer.byteLength(await read('bulk.boundary.xml'))
    const entry = (i: number, padding: number): SitemapEntry => ({
      path: `/boundary/${String(i).padStart(5, '0')}/&é${'x'.repeat(padding)}`,
      lastmod: '2026-10-01T00:00:00Z',
    })
    boundaryEntries = [entry(0, 0)]
    const entryBytes = Buffer.byteLength(await read('bulk.boundary.xml')) - wrapperBytes
    const width = Math.floor((50_000_000 - wrapperBytes) / 50_000)
    const remainder = 50_000_000 - wrapperBytes - width * 50_000 + delta
    boundaryEntries = Array.from({ length: 50_000 }, (_, i) =>
      entry(i, width - entryBytes + (i < remainder ? 1 : 0)),
    )
    const response = await boundary.publicFetch(`${origin}/api/cms/sitemap.xml`)
    expect(response.status).toBe(200)
    const children = locs(await response.text()).filter((loc) => loc.includes('/bulk.boundary'))
    expect(children).toEqual(
      delta <= 0
        ? [`${origin}/api/cms/sitemaps/bulk.boundary.xml`]
        : [1, 2].map((i) => `${origin}/api/cms/sitemaps/bulk.boundary-${i}.xml`),
    )
    let totalBytes = 0
    const actual: string[] = []
    for (const child of children) {
      const body = await read(new URL(child).pathname.split('/').at(-1)!)
      const bytes = Buffer.byteLength(body)
      expect(bytes).toBeLessThanOrEqual(50_000_000)
      const urls = locs(body)
      expect(urls.length).toBeGreaterThan(0)
      expect(urls.length).toBeLessThanOrEqual(50_000)
      totalBytes += bytes
      actual.push(...urls)
    }
    expect(totalBytes).toBe(50_000_000 + delta + (children.length - 1) * wrapperBytes)
    expect(actual).toEqual(boundaryEntries.map((e) => escaped(e.path)))
  },
  60_000,
)

test('an entry larger than a whole sitemap fails instead of serving invalid XML', async () => {
  boundaryEntries = [{ path: `/oversized/${'x'.repeat(50_000_000)}` }]
  for (const path of ['/sitemap.xml', '/sitemaps/bulk.boundary.xml']) {
    const response = await boundary.publicFetch(`${origin}/api/cms${path}`)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('/oversized/')
  }
}, 60_000)
