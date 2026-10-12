import { Effect, Schema } from 'effect'
import {
  CmsInvalid,
  type CmsDefinitions,
  labelText,
  type PageDocument,
  type PageLocale,
  type Section,
  type SectionType,
  sectionDataSchema,
} from '../api.ts'
import { sanitizeRichText } from './sanitize.ts'

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Locale-relative path: `/` or lowercase segments of letters, digits and dashes. */
const pathPattern = /^\/(?:[\p{Ll}\p{Lo}\p{N}-]+(?:\/[\p{Ll}\p{Lo}\p{N}-]+)*)?$/u
const maxSections = 200

const invalid = (message: string) => new CmsInvalid({ message })

export const emptyLocale = (path = ''): PageLocale => ({
  path,
  available: false,
  seo: { title: '', description: '', image: null, noindex: false },
})

const cleanLocale = (locale: string, given: PageLocale | undefined) =>
  Effect.gen(function* () {
    if (!given) return emptyLocale()
    const path = given.path.trim()
    if (path !== '' && !pathPattern.test(path))
      return yield* invalid(
        `The ${locale} path "${path}" must start with "/" and use lowercase letters, digits and dashes.`,
      )
    if (given.available && path === '')
      return yield* invalid(`The page is available in ${locale}, so it needs a ${locale} path.`)
    const image = given.seo.image
    if (image !== null && !uuid.test(image))
      return yield* invalid(`The ${locale} social image is not a media item.`)
    return {
      path,
      available: given.available,
      seo: {
        title: given.seo.title.trim().slice(0, 300),
        description: given.seo.description.trim().slice(0, 1000),
        image,
        noindex: given.seo.noindex,
      },
    }
  })

const present = (value: unknown) => value !== null && value !== undefined && value !== ''
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Decodes a section's data against its type, drops empty values and unknown locales and
 *  sanitizes rich text. */
const cleanData = (
  type: SectionType,
  data: Readonly<Record<string, unknown>>,
  locales: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const decoded: Readonly<Record<string, unknown>> = yield* Schema.decodeUnknownEffect(
      sectionDataSchema(type),
    )(data)
    const clean = (kind: string, value: unknown) =>
      kind === 'richText' && typeof value === 'string' ? sanitizeRichText(value) : value
    const out: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(type.fields)) {
      const value = decoded[name]
      if (!present(value)) continue
      if (field.localized) {
        const values = Object.fromEntries(
          Object.entries(isRecord(value) ? value : {})
            .filter(([locale]) => locales.includes(locale))
            .map(([locale, v]) => [locale, clean(field.kind, v)])
            .filter(([, v]) => present(v)),
        )
        if (Object.keys(values).length > 0) out[name] = values
      } else {
        const v = clean(field.kind, value)
        if (present(v)) out[name] = v
      }
    }
    return out
  })

/**
 * Validates a page document against the host's definitions and normalizes it: one entry per
 * content locale, valid paths, known section types, field values per their schemas, sanitized
 * rich text. Drafts may be incomplete; `checkRequired` runs on publish.
 */
export const normalizeDocument = (
  definitions: CmsDefinitions,
  locales: ReadonlyArray<string>,
  document: PageDocument,
): Effect.Effect<PageDocument, CmsInvalid> =>
  Effect.gen(function* () {
    if (document.sections.length > maxSections)
      return yield* invalid(`A page holds at most ${maxSections} sections.`)
    const pageLocales: Record<string, PageLocale> = {}
    for (const locale of locales)
      pageLocales[locale] = yield* cleanLocale(locale, document.locales[locale])
    const sections: Array<Section> = []
    for (const [index, section] of document.sections.entries()) {
      const type: SectionType | undefined = Object.hasOwn(definitions.sections, section.type)
        ? definitions.sections[section.type]
        : undefined
      if (!type)
        return yield* invalid(`Section ${index + 1} has an unknown type "${section.type}".`)
      const data = yield* cleanData(type, section.data, locales).pipe(
        Effect.mapError((error) =>
          invalid(`Section ${index + 1} (${labelText(type.label, 'en')}): ${error.message}`),
        ),
      )
      sections.push({
        id: uuid.test(section.id) ? section.id : crypto.randomUUID(),
        type: section.type,
        data,
      })
    }
    return { locales: pageLocales, sections }
  })

/** Publishing needs every required field filled (in the default locale, if localized). */
export const checkRequired = (
  definitions: CmsDefinitions,
  defaultLocale: string,
  document: PageDocument,
): Effect.Effect<void, CmsInvalid> =>
  Effect.gen(function* () {
    for (const [index, section] of document.sections.entries()) {
      const type = definitions.sections[section.type]
      if (!type)
        return yield* invalid(`Section ${index + 1} has an unknown type "${section.type}".`)
      for (const [name, field] of Object.entries(type.fields)) {
        const value = section.data[name]
        const filled = field.localized
          ? isRecord(value) && present(value[defaultLocale])
          : present(value)
        if (field.required && !filled)
          return yield* invalid(
            `Section ${index + 1} (${labelText(type.label, 'en')}): "${labelText(field.label, 'en')}" is required${field.localized ? ` in ${defaultLocale}` : ''}.`,
          )
      }
    }
  })

/** A section's data in one locale: localized fields resolved, falling back to `fallback`. */
export const localizeSection = (
  definitions: CmsDefinitions,
  section: Section,
  locale: string,
  fallback: string,
): Section => {
  const type = definitions.sections[section.type]
  if (!type) return section
  const data: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(section.data)) {
    const field = type.fields[name]
    if (!field) continue
    if (!field.localized) data[name] = value
    else {
      const values = isRecord(value) ? value : {}
      data[name] = values[locale] ?? values[fallback] ?? null
    }
  }
  return { ...section, data }
}
