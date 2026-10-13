import { type Contribution, defineExtensionPoint } from '@opulonjs/core'
import xss from 'xss'
import type * as Xss from 'xss'
import { type EmailComponent, escapeHtml } from './components.ts'

/** Who a template is written for: staff (admin locales) or public visitors (content locales). */
export type EmailAudience = 'staff' | 'public'

/** One locale's wording. Both parts may use `{{placeholder}}` tokens. */
export interface EmailContent {
  /** Plain text. */
  readonly subject: string
  /**
   * Restricted HTML (paragraphs, headings, bold/italic, links, lists, quotes) with email
   * components as `[[name prop="value"]]` alone in a paragraph; values are HTML-escaped.
   */
  readonly body: string
}

export interface EmailTemplate<P extends string = string> {
  /** Unique, inside the contributing module's prefix: `users.invitation`. */
  readonly key: string
  readonly audience: EmailAudience
  /** Every placeholder the wording may use, with a sample value (previews, test sends). */
  readonly placeholders: Readonly<Record<P, string>>
  /** Default wording per locale; a missing locale falls back to the audience's default. */
  readonly defaults: Readonly<Record<string, EmailContent>>
}

/** The emails module's extension point; modules contribute through `emailTemplate`. */
export const EmailTemplates = defineExtensionPoint<EmailTemplate>('emails', 'emailTemplate')

const placeholderPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Declares an email template. List the result in the module's `contributes` (the module must
 * depend on emails) and pass it to `EmailService.send`. Wording using an undeclared placeholder
 * throws at startup.
 */
export const emailTemplate = <const P extends string>(
  template: EmailTemplate<P>,
): Contribution<EmailTemplate<P>> => {
  const declared = new Set<string>(Object.keys(template.placeholders))
  const locales = Object.entries(template.defaults)
  if (locales.length === 0) throw new Error(`email template "${template.key}" has no defaults`)
  for (const [locale, content] of locales)
    for (const [, name] of `${content.subject} ${content.body}`.matchAll(placeholderPattern))
      if (!declared.has(name!))
        throw new Error(
          `email template "${template.key}" (${locale}) uses undeclared placeholder "${name}"`,
        )
  // Safe: the value is `template` itself; the extension point only erases its placeholder names.
  return EmailTemplates.contribute(template) as Contribution<EmailTemplate<P>>
}

/** The host's email branding (server side, separate from the admin brand). */
export interface EmailBrand {
  readonly name: string
  /** Absolute https URL of the logo shown in the header. */
  readonly logoUrl?: string
  /** CSS color of the header accent and buttons. Default `#2563eb`. */
  readonly primaryColor?: string
  /** Footer line per locale (falls back to the brand name). */
  readonly footer?: Readonly<Record<string, string>>
}

export interface LayoutInput {
  readonly locale: string
  /** The rendered subject (plain text; escape it). */
  readonly subject: string
  /** The rendered body HTML (already escaped). */
  readonly body: string
  readonly brand: EmailBrand
}

/** Wraps a rendered body into the full HTML document. Hosts may pass their own to `emails()`. */
export type EmailLayout = (input: LayoutInput) => string

/** The package's layout: a branded header, the body in a card, and a footer line. */
export const defaultLayout: EmailLayout = ({ locale, subject, body, brand }) => {
  const color = escapeHtml(brand.primaryColor ?? '#2563eb')
  const name = escapeHtml(brand.name)
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" style="max-height: 48px;">`
    : `<strong style="font-size: 20px; color: ${color};">${name}</strong>`
  const footer = escapeHtml(brand.footer?.[locale] ?? brand.name)
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="padding: 20px 0; border-bottom: 3px solid ${color}; margin-bottom: 20px;">${header}</div>
  <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
${body}
  </div>
  <div style="text-align: center; color: #6b7280; font-size: 14px; padding: 20px;">${footer}</div>
</body>
</html>`
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#039': "'",
  nbsp: ' ',
}

/** The plain-text part, derived from the body HTML. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#039|nbsp);/g, (_, e: string) => entities[e] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** http(s) and mailto URLs only. */
const isSafeUrl = (value: string) => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

// xss is CommonJS without detectable named exports, so Node's ESM loader only offers the default
// (module.exports, which carries them all); its typings declare them as named exports only.
const { escapeAttrValue, FilterXSS, friendlyAttrValue } = xss as unknown as typeof Xss
const exactPlaceholder = /^\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}$/
const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li']
const allowedBlocks = ['h2', 'h3', 'blockquote']

const sanitizer = new FilterXSS({
  whiteList: Object.fromEntries(
    [...allowedTags, ...allowedBlocks].map((tag) => [tag, tag === 'a' ? ['href'] : []]),
  ),
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  onTagAttr: (_tag, name, value) => {
    if (name !== 'href') return undefined
    // A safe URL or exactly one placeholder (whose value is checked at send time).
    const href = friendlyAttrValue(value).trim()
    return exactPlaceholder.test(href) || isSafeUrl(href) ? `href="${escapeAttrValue(href)}"` : ''
  },
})

/**
 * Reduces staff-authored HTML to the restricted body format: paragraphs, h2/h3, bold, italic,
 * underline, strike, lists, quotes and links (http(s), mailto or a placeholder). Other tags and
 * attributes are dropped, script and style with their contents.
 */
export const sanitizeBody = (html: string): string => sanitizer.process(html)

const placeholder = String.raw`\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}`
const token = String.raw`\[\[([a-z][a-z0-9_]*)([^\[\]<>]*)\]\]`
const tokenPattern = new RegExp(token, 'g')
// One pass, so an inserted value is never scanned again: a component token (with the paragraph
// it fills), a placeholder as a whole link target, or a placeholder in text.
const bodyPattern = new RegExp(
  String.raw`(<p>\s*)?${token}(\s*</p>)?|href="${placeholder}"|${placeholder}`,
  'g',
)

const argEntities: Record<string, string> = { quot: '"', '#34': '"', '#039': "'", '#39': "'" }
const argPattern = /([A-Za-z][A-Za-z0-9_]*)="([^"]*)"/g

/** Parses a token's `prop="value"` list (as the editor escaped it); null on anything else. */
const parseArgs = (raw: string): Record<string, string> | null => {
  const text = raw
    .replace(/&(quot|#34|#0?39);/g, (_, e: string) => argEntities[e] ?? '')
    .replace(/&amp;/g, '&')
  if (text.replace(argPattern, '').trim() !== '') return null
  return Object.fromEntries([...text.matchAll(argPattern)].map(([, k, v]) => [k!, v!]))
}

const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  text.replace(new RegExp(placeholder, 'g'), (_, name: string) => vars[name] ?? '')

/** The first rule `content` breaks, or undefined. Pass a sanitized body. */
export const contentError = (
  template: EmailTemplate,
  content: EmailContent,
  components: ReadonlyMap<string, EmailComponent>,
): string | undefined => {
  if (content.subject.trim() === '') return 'the subject is empty'
  if (content.subject.length > 255) return 'the subject is longer than 255 characters'
  if (content.body.length > 65_536) return 'the body is longer than 64 KiB'
  const text = `${content.subject} ${content.body}`
  for (const [, name] of text.matchAll(placeholderPattern))
    if (!(name! in template.placeholders)) return `undeclared placeholder "${name}"`
  const rest = text.replace(placeholderPattern, '')
  if (rest.includes('{{') || rest.includes('}}')) return 'a malformed placeholder'
  for (const [, name, raw] of content.body.matchAll(tokenPattern)) {
    const component = components.get(name!)
    if (!component) return `unknown email component "${name}"`
    const args = parseArgs(raw!)
    if (!args) return `malformed email component "${name}"`
    for (const prop of Object.keys(args))
      if (!(prop in component.props)) return `email component "${name}" has no prop "${prop}"`
  }
  return undefined
}

export interface RenderedEmail {
  readonly subject: string
  readonly html: string
  readonly text: string
}

/**
 * Renders one locale's wording with the given values into subject, HTML and text. The body is
 * sanitized first, components are rendered, values are HTML-escaped, and a value used as a
 * whole link target must be an http(s) or mailto URL.
 */
export const renderEmail = (o: {
  readonly content: EmailContent
  readonly locale: string
  readonly vars: Readonly<Record<string, string>>
  readonly brand: EmailBrand
  readonly layout: EmailLayout
  readonly components: ReadonlyMap<string, EmailComponent>
}): RenderedEmail => {
  // A subject is one line: control characters (e.g. a newline in a value) become spaces.
  const subject = fill(o.content.subject, o.vars)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 255)
  const value = (name: string) => o.vars[name] ?? ''
  const component = (name: string, raw: string) => {
    const definition = o.components.get(name)
    const args = parseArgs(raw)
    if (!definition || !args) return ''
    const props = Object.fromEntries(
      Object.entries(definition.props).map(([prop, kind]) => {
        const filled = args[prop] === undefined ? undefined : fill(args[prop], o.vars)
        return [prop, kind === 'url' && filled && !isSafeUrl(filled) ? undefined : filled]
      }),
    )
    return definition.render(props, { brand: o.brand, locale: o.locale })
  }
  const body = sanitizeBody(o.content.body).replace(
    bodyPattern,
    (
      _match,
      open: string | undefined,
      name: string | undefined,
      raw: string | undefined,
      close: string | undefined,
      href: string | undefined,
      text: string | undefined,
    ) => {
      if (text !== undefined) return escapeHtml(value(text))
      if (href !== undefined) {
        const url = value(href).trim()
        return `href="${isSafeUrl(url) ? escapeHtml(url) : ''}"`
      }
      const html = component(name!, raw!)
      // Alone in its paragraph, a component replaces it (blocks may not nest in a <p>).
      return open !== undefined && close !== undefined ? html : `${open ?? ''}${html}${close ?? ''}`
    },
  )
  return {
    subject,
    html: o.layout({ locale: o.locale, subject, body, brand: o.brand }),
    text: htmlToText(body),
  }
}

/**
 * The locale a template is sent in: the requested one when it belongs to the audience's
 * locales and the template has wording for it, else the audience's default, else the
 * template's first locale.
 */
export const resolveLocale = (
  template: EmailTemplate,
  requested: string | null | undefined,
  locales: ReadonlyArray<string>,
): string => {
  const has = (l: string | null | undefined): l is string => !!l && l in template.defaults
  if (has(requested) && locales.includes(requested)) return requested
  if (has(locales[0])) return locales[0]
  return Object.keys(template.defaults)[0]!
}
