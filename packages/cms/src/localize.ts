// Client-safe, no runtime imports: the server (Read API, preview) and the admin's live preview
// localize documents with the same code.
import type {
  CmsDefinitions,
  FieldGroup,
  PageDocument,
  PageLocale,
  PagePreview,
  Section,
} from './api.ts'

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const emptyLocale = (path = ''): PageLocale => ({
  path,
  available: false,
  seo: { title: '', description: '', image: null, noindex: false },
})

/** A field group's data in one locale: localized fields resolved, falling back to `fallback`. */
export const localizeData = (
  group: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  locale: string,
  fallback: string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(data)) {
    const field = group.fields[name]
    if (!field) continue
    if (!field.localized) out[name] = value
    else {
      const values = isRecord(value) ? value : {}
      out[name] = values[locale] ?? values[fallback] ?? null
    }
  }
  return out
}

const localizeSection = (
  definitions: CmsDefinitions,
  section: Section,
  locale: string,
  fallback: string,
): Section => {
  const type = definitions.sections[section.type]
  return type ? { ...section, data: localizeData(type, section.data, locale, fallback) } : section
}

/**
 * A page's draft as a site renders it in one locale: the requested content locale, else the
 * default (the first of `locales`), localized fields falling back to the default.
 */
export const pagePreview = (
  definitions: CmsDefinitions,
  locales: ReadonlyArray<string>,
  page: { readonly id: string; readonly draft: PageDocument },
  requested?: string,
): PagePreview => {
  const fallback = locales[0]!
  const locale = requested && locales.includes(requested) ? requested : fallback
  const own = page.draft.locales[locale] ?? emptyLocale()
  return {
    id: page.id,
    locale,
    path: own.path,
    seo: own.seo,
    sections: page.draft.sections.map((s) => localizeSection(definitions, s, locale, fallback)),
  }
}
