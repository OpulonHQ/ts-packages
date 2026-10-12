import { type Contribution, defineExtensionPoint } from '@opulonjs/core'

/** Who a template is written for: staff (admin locales) or public visitors (content locales). */
export type EmailAudience = 'staff' | 'public'

/** One locale's wording. Both parts may use `{{placeholder}}` tokens. */
export interface EmailContent {
  /** Plain text. */
  readonly subject: string
  /** Restricted HTML (paragraphs, bold/italic, links, lists); values are HTML-escaped. */
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

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => htmlEscapes[c] ?? c)

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

const fill = (text: string, vars: Readonly<Record<string, string>>, escape: boolean) =>
  text.replace(placeholderPattern, (_, name: string) => {
    const value = vars[name] ?? ''
    return escape ? escapeHtml(value) : value
  })

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
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#039|nbsp);/g, (_, e: string) => entities[e] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export interface RenderedEmail {
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** Renders one locale's wording with the given values into subject, HTML and text. */
export const renderEmail = (o: {
  readonly content: EmailContent
  readonly locale: string
  readonly vars: Readonly<Record<string, string>>
  readonly brand: EmailBrand
  readonly layout: EmailLayout
}): RenderedEmail => {
  // A subject is one line: control characters (e.g. a newline in a value) become spaces.
  const subject = fill(o.content.subject, o.vars, false)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 255)
  const body = fill(o.content.body, o.vars, true)
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
