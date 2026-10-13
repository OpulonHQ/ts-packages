import { Effect } from 'effect'
import type { SitemapEntry } from './sitemap.ts'

export const maxUrls = 50_000
const maxBytes = 50_000_000
const urlsetStart =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
  'xmlns:xhtml="http://www.w3.org/1999/xhtml">'
const urlsetEnd = '</urlset>\n'
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )

export const sitemapXml = (origin: string, locales: ReadonlyArray<string>) => {
  const url = (path: string) => escape(encodeURI(`${origin}${path}`))
  const lastmod = (value: string | undefined) =>
    value === undefined ? '' : `<lastmod>${escape(value)}</lastmod>`
  const entryXml = (entry: SitemapEntry) => {
    const alternates = entry.alternates ?? []
    const fallback = alternates.find((a) => a.locale === locales[0])
    const link = (locale: string, path: string) =>
      `<xhtml:link rel="alternate" hreflang="${escape(locale)}" href="${url(path)}"/>`
    return (
      `<url><loc>${url(entry.path)}</loc>${lastmod(entry.lastmod)}` +
      alternates.map((a) => link(a.locale, a.path)).join('') +
      (fallback ? link('x-default', fallback.path) : '') +
      '</url>'
    )
  }
  const encoder = new TextEncoder()
  const wrapperBytes = encoder.encode(urlsetStart + urlsetEnd).byteLength
  const files = (key: string, entries: ReadonlyArray<SitemapEntry>) =>
    Effect.gen(function* () {
      const chunks: ReadonlyArray<SitemapEntry>[] = []
      let start = 0
      let bytes = wrapperBytes
      for (const [i, entry] of entries.entries()) {
        const entryBytes = encoder.encode(entryXml(entry)).byteLength
        if (wrapperBytes + entryBytes > maxBytes) {
          return yield* Effect.die(new Error(`Sitemap entry exceeds byte limit: ${key}`))
        }
        if (i - start === maxUrls || bytes + entryBytes > maxBytes) {
          chunks.push(entries.slice(start, i))
          start = i
          bytes = wrapperBytes
        }
        bytes += entryBytes
      }
      chunks.push(entries.slice(start))
      return chunks.map((entries, i) => ({
        name: chunks.length === 1 ? `${key}.xml` : `${key}-${i + 1}.xml`,
        entries,
      }))
    })

  return {
    url,
    lastmod,
    files,
    body: (entries: ReadonlyArray<SitemapEntry>) =>
      urlsetStart + entries.map(entryXml).join('') + urlsetEnd,
  }
}
