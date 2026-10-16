import sanitizeHtml from 'sanitize-html'
import type { FieldGroup, Link, PageLocale } from './api.ts'
import { urlPattern } from './document-rules.ts'
import { isRecord } from './localize.ts'

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

export const cleanLocaleText = (given: PageLocale): PageLocale => ({
  path: given.path.trim(),
  available: given.available,
  seo: {
    title: given.seo.title.trim().slice(0, 300),
    description: given.seo.description.trim().slice(0, 1000),
    image: given.seo.image,
    noindex: given.seo.noindex,
  },
})

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
    if (field.localized) {
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
