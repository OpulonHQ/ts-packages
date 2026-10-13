import type { EmailBrand } from './template.ts'

/** `text`: any text; `url`: an http(s) or mailto URL (anything else renders as ''). */
export type EmailComponentPropKind = 'text' | 'url'

/**
 * A block a template body inserts as `[[name prop="value"]]` (alone in its paragraph). Props may
 * use the template's placeholders. It is rendered at send time, so stored overrides pick up
 * branding and component fixes.
 */
export interface EmailComponent {
  /** `[a-z][a-z0-9_]*`, unique among the package's and the host's components. */
  readonly name: string
  /** Prop names to kinds, in the order the admin editor asks for them. */
  readonly props: Readonly<Record<string, EmailComponentPropKind>>
  /**
   * Returns the component's HTML. Prop values arrive with placeholders filled in and are NOT
   * escaped: escape every one (`escapeHtml`). A missing prop is undefined.
   */
  readonly render: (
    props: Readonly<Record<string, string | undefined>>,
    context: { readonly brand: EmailBrand; readonly locale: string },
  ) => string
}

/** Declares an email component; pass it to `emails({ components })`. */
export const emailComponent = (component: EmailComponent): EmailComponent => component

export const componentNamePattern = /^[a-z][a-z0-9_]*$/

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => htmlEscapes[c] ?? c)

const color = (brand: EmailBrand) => escapeHtml(brand.primaryColor ?? '#2563eb')

/** The package's components: button, callout, divider and a key/value table. */
export const defaultComponents: ReadonlyArray<EmailComponent> = [
  emailComponent({
    name: 'button',
    props: { label: 'text', href: 'url' },
    render: ({ label = '', href }, { brand }) => {
      const text = escapeHtml(label)
      if (!href) return `<p><strong>${text}</strong></p>`
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;"><tr><td style="border-radius: 6px; background-color: ${color(brand)};"><a href="${escapeHtml(href)}" style="display: inline-block; padding: 12px 24px; color: #ffffff; font-weight: bold; text-decoration: none;">${text}</a></td></tr></table>`
    },
  }),
  emailComponent({
    name: 'callout',
    props: { text: 'text' },
    render: ({ text = '' }, { brand }) =>
      `<div style="border-left: 4px solid ${color(brand)}; background-color: #f3f4f6; padding: 12px 16px; margin: 16px 0;">${escapeHtml(text)}</div>`,
  }),
  emailComponent({
    name: 'divider',
    props: {},
    render: () => '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">',
  }),
  emailComponent({
    name: 'table',
    // `Label: value; Other label: value`
    props: { rows: 'text' },
    render: ({ rows = '' }) => {
      const cells = rows
        .split(';')
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row) => {
          const at = row.indexOf(':')
          const [label, value] = at < 0 ? ['', row] : [row.slice(0, at), row.slice(at + 1)]
          return `<tr><td style="padding: 6px 12px 6px 0; color: #6b7280;">${escapeHtml(label.trim())}</td><td style="padding: 6px 0;">${escapeHtml(value.trim())}</td></tr>`
        })
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 16px 0;">${cells.join('')}</table>`
    },
  }),
]

/** Package defaults plus the host's; throws on a bad or duplicate name. */
export const componentRegistry = (
  host: ReadonlyArray<EmailComponent> = [],
): ReadonlyMap<string, EmailComponent> => {
  const registry = new Map<string, EmailComponent>()
  for (const c of [...defaultComponents, ...host]) {
    if (!componentNamePattern.test(c.name))
      throw new Error(`email component name "${c.name}" must match ${componentNamePattern}`)
    if (registry.has(c.name)) throw new Error(`email component "${c.name}" is registered twice`)
    registry.set(c.name, c)
  }
  return registry
}
