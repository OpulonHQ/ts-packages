import { Effect, Schema } from 'effect'
import {
  CmsInvalid,
  type CmsDefinitions,
  type FieldGroup,
  labelText,
  type Link,
  type PageDocument,
  type PageLocale,
  type Section,
  type SectionType,
  sectionDataSchema,
} from '../api.ts'
import { linkProblem, maxSections, uuid } from '../document-rules.ts'
import { emptyLocale, isRecord } from '../localize.ts'
import { sanitizeRichText } from '../sanitize.ts'

/** Locale-relative path: `/` or lowercase segments of letters, digits and dashes. */
const pathPattern = /^\/(?:[\p{Ll}\p{Lo}\p{N}-]+(?:\/[\p{Ll}\p{Lo}\p{N}-]+)*)?$/u
/** Characters of a locale-relative path, for pages, items and redirects alike: what a write
 *  accepts, `resolve` answers (after the locale prefix). */
export const maxPathLength = 1024

const invalid = (message: string) => new CmsInvalid({ message })

/** Path, availability and SEO per content locale; documents without paths refuse one. */
export const cleanLocales = (
  locales: ReadonlyArray<string>,
  given: Readonly<Record<string, PageLocale>>,
  withPaths = true,
) =>
  Effect.gen(function* () {
    const out: Record<string, PageLocale> = {}
    for (const locale of locales) {
      const own = given[locale]
      if (!withPaths && own && own.path.trim() !== '')
        return yield* invalid(`These items have no own path, so the ${locale} path must be empty.`)
      out[locale] = yield* cleanLocale(locale, own, withPaths)
      // Other locales' public paths start with their prefix, which would shadow this path.
      const first = out[locale]!.path.split('/')[1]
      if (locale === locales[0] && first !== undefined && locales.includes(first))
        return yield* invalid(
          `The ${locale} path "${out[locale]!.path}" starts with "/${first}", the prefix of ${first} pages.`,
        )
    }
    return out
  })

const cleanLocale = (locale: string, given: PageLocale | undefined, withPaths = true) =>
  Effect.gen(function* () {
    if (!given) return emptyLocale()
    const path = given.path.trim()
    if (path !== '' && !pathPattern.test(path))
      return yield* invalid(
        `The ${locale} path "${path}" must start with "/" and use lowercase letters, digits and dashes.`,
      )
    if (path.length > maxPathLength)
      return yield* invalid(`The ${locale} path is longer than ${maxPathLength} characters.`)
    if (withPaths && given.available && path === '')
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

const isLink = (value: unknown): value is Link => isRecord(value) && typeof value.type === 'string'

/** Decodes a field group's data against its fields, drops empty values and unknown locales,
 *  checks links and sanitizes rich text. */
export const cleanData = (
  definitions: CmsDefinitions,
  type: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  locales: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const decoded: Readonly<Record<string, unknown>> = yield* Schema.decodeUnknownEffect(
      sectionDataSchema(type),
    )(data).pipe(Effect.mapError((error) => invalid(error.message)))
    for (const [name, field] of Object.entries(type.fields)) {
      if (field.kind !== 'link') continue
      const value = decoded[name]
      const links = field.localized && isRecord(value) ? Object.values(value) : [value]
      for (const link of links) {
        const problem = isLink(link) ? linkProblem(definitions, link) : undefined
        if (problem) return yield* invalid(`"${labelText(field.label, 'en')}": ${problem}`)
      }
    }
    const clean = (kind: string, value: unknown) =>
      kind === 'richText' && typeof value === 'string'
        ? sanitizeRichText(value)
        : kind === 'link' && isLink(value) && value.type === 'url'
          ? { type: 'url', url: value.url.trim() }
          : value
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
    const pageLocales = yield* cleanLocales(locales, document.locales)
    const sections: Array<Section> = []
    for (const [index, section] of document.sections.entries()) {
      const type: SectionType | undefined = Object.hasOwn(definitions.sections, section.type)
        ? definitions.sections[section.type]
        : undefined
      if (!type)
        return yield* invalid(`Section ${index + 1} has an unknown type "${section.type}".`)
      const data = yield* cleanData(definitions, type, section.data, locales).pipe(
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

/** Every required field of a group filled (in the default locale, if localized). */
export const checkFields = (
  group: FieldGroup,
  defaultLocale: string,
  data: Readonly<Record<string, unknown>>,
): Effect.Effect<void, CmsInvalid> =>
  Effect.gen(function* () {
    for (const [name, field] of Object.entries(group.fields)) {
      const value = data[name]
      const filled = field.localized
        ? isRecord(value) && present(value[defaultLocale])
        : Array.isArray(value)
          ? value.length > 0
          : present(value)
      if (field.required && !filled)
        return yield* invalid(
          `"${labelText(field.label, 'en')}" is required${field.localized ? ` in ${defaultLocale}` : ''}.`,
        )
    }
  })

/** Publishing a page needs every section's required fields filled. */
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
      yield* checkFields(type, defaultLocale, section.data).pipe(
        Effect.mapError((error) =>
          invalid(`Section ${index + 1} (${labelText(type.label, 'en')}): ${error.message}`),
        ),
      )
    }
  })
