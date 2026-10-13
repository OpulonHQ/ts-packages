import { expect, test } from 'vitest'
import { useCmsHost } from './helpers.ts'

const host = useCmsHost()
const origin = 'https://host.test'
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
const escaped = (path: string) => encodeURI(`${origin}${path}`).replaceAll('&', '&amp;')

const cases = [{ name: 'count split', suffix: '' }]
if (process.env.SITEMAP_TIMINGS === '1') {
  cases.push({
    name: 'escaped XML byte split',
    suffix: 'é&'.repeat(40),
  })
}

test.each(cases)(
  'cms pages sitemap preserves every URL at the $name',
  async ({ suffix }) => {
    const count = 50_001
    await host.query('truncate cms.path, cms.revision, cms.document')
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
    expect(children.length).toBeGreaterThanOrEqual(2)
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
    if (process.env.SITEMAP_TIMINGS === '1') {
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
  process.env.SITEMAP_TIMINGS === '1' ? 60_000 : undefined,
)
