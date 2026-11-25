import sanitizeHtml from 'sanitize-html'
import type { FieldGroup, Link, PageLocale } from './api.ts'
import { urlPattern, uuid } from './document-rules.ts'
import { isRecord, listItems } from './localize.ts'

// The restricted rich text format (TSPACK-11): what RichTextControl's toolbar produces, nothing
// else. sanitize-html parses with htmlparser2 (no DOM), so it runs on Workers.
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'blockquote',
  ],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Text of dropped tags stays, except for these, whose content is never text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'svg'],
}

/** Sanitizes editor HTML against the allowlist; empty results become null. */
export const sanitizeRichText = (html: string): string | null => {
  const clean = sanitizeHtml(html, options).trim()
  return clean === '' || clean === '<p></p>' ? null : clean
}

export const maxJsonLdLength = 20_000

export const cleanLocaleText = (given: PageLocale): PageLocale => {
  const keywords = given.seo.keywords?.trim().slice(0, 500)
  const canonical = given.seo.canonical?.trim().slice(0, 2048)
  const jsonLd = given.seo.jsonLd?.trim()
  return {
    path: given.path.trim(),
    available: given.available,
    seo: {
      title: given.seo.title.trim().slice(0, 300),
      description: given.seo.description.trim().slice(0, 1000),
      image: given.seo.image,
      noindex: given.seo.noindex,
      ...(keywords ? { keywords } : {}),
      ...(canonical ? { canonical } : {}),
      ...(jsonLd ? { jsonLd } : {}),
    },
  }
}

export const present = (value: unknown) => value !== null && value !== undefined && value !== ''

export const isLink = (value: unknown): value is Link =>
  isRecord(value) && typeof value.type === 'string'

const cleanUrlLink = (url: string) => {
  const trimmed = url.trim()
  return urlPattern.test(trimmed) ? { type: 'url', url: trimmed } : null
}

const cleanValue = (kind: string, value: unknown) =>
  kind === 'richText' && typeof value === 'string'
    ? sanitizeRichText(value)
    : kind === 'link' && isLink(value) && value.type === 'url' && typeof value.url === 'string'
      ? cleanUrlLink(value.url)
      : value

export const cleanFields = (
  group: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  locales: ReadonlyArray<string>,
) => {
  const out: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(group.fields)) {
    const value = data[name]
    if (!present(value)) continue
    if (field.kind === 'list') {
      const ids = new Set<string>()
      const items = listItems(value).map((item) => {
        const id = uuid.test(item.id) && !ids.has(item.id) ? item.id : crypto.randomUUID()
        ids.add(id)
        return { id, data: cleanFields({ fields: field.item ?? {} }, item.data, locales) }
      })
      if (items.length > 0) out[name] = items
    } else if (field.localized) {
      const values = Object.fromEntries(
        Object.entries(isRecord(value) ? value : {})
          .filter(([locale]) => locales.includes(locale))
          .map(([locale, v]) => [locale, cleanValue(field.kind, v)])
          .filter(([, v]) => present(v)),
      )
      if (Object.keys(values).length > 0) out[name] = values
    } else {
      const v = cleanValue(field.kind, value)
      if (present(v)) out[name] = v
    }
  }
  return out
}
