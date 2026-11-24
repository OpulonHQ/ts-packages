import { Effect, Schema } from 'effect'
import {
  CmsInvalid,
  type CmsDefinitions,
  type FieldGroup,
  labelText,
  type PageDocument,
  type PageLocale,
  type Section,
  type SectionType,
  sectionDataSchema,
} from '../api.ts'
import { linkProblem, maxSections, uuid } from '../document-rules.ts'
import { availableLocales, emptyLocale, isRecord } from '../localize.ts'
import { cleanFields, cleanLocaleText, isLink, maxJsonLdLength, present } from '../sanitize.ts'

/** Locale-relative path: `/` or lowercase segments of letters, digits and dashes. */
const pathPattern = /^\/(?:[\p{Ll}\p{Lo}\p{N}-]+(?:\/[\p{Ll}\p{Lo}\p{N}-]+)*)?$/u
/** Characters of a locale-relative path, for pages, items and redirects alike: what a write
 *  accepts, `resolve` answers (after the locale prefix). */
export const maxPathLength = 1024
const canonicalPattern = /^(?:https?:\/\/|\/(?!\/))\S*$/i

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
      out[locale] =
        !withPaths && !own
          ? { ...emptyLocale(), available: true }
          : yield* cleanLocale(locale, own, withPaths)
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
    const clean = cleanLocaleText(given)
    const path = clean.path
    if (path !== '' && !pathPattern.test(path))
      return yield* invalid(
        `The ${locale} path "${path}" must start with "/" and use lowercase letters, digits and dashes.`,
      )
    if (path.length > maxPathLength)
      return yield* invalid(`The ${locale} path is longer than ${maxPathLength} characters.`)
    if (withPaths && given.available && path === '')
      return yield* invalid(`The page is available in ${locale}, so it needs a ${locale} path.`)
    const image = clean.seo.image
    if (image !== null && !uuid.test(image))
      return yield* invalid(`The ${locale} social image is not a media item.`)
    const { canonical, jsonLd } = clean.seo
    if (canonical !== undefined && !canonicalPattern.test(canonical))
      return yield* invalid(`The ${locale} canonical URL must start with https:// or "/".`)
    if (jsonLd !== undefined) {
      if (jsonLd.length > maxJsonLdLength)
        return yield* invalid(
          `The ${locale} structured data is longer than ${maxJsonLdLength} characters.`,
        )
      const parsed = yield* Effect.try({
        try: (): unknown => JSON.parse(jsonLd),
        catch: () => invalid(`The ${locale} structured data is not valid JSON.`),
      })
      if (typeof parsed !== 'object' || parsed === null)
        return yield* invalid(`The ${locale} structured data must be a JSON object or array.`)
    }
    return clean
  })

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
    return cleanFields(type, decoded, locales)
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

/**
 * The locales a document's required localized fields must be filled in on publish: those it is
 * available in, or the default one when none. A value in the default locale fills any of them,
 * as the Read API falls back to it.
 */
export const requiredLocales = (
  locales: ReadonlyArray<string>,
  own: Readonly<Record<string, PageLocale>>,
  routed: boolean,
) => {
  const available = availableLocales(locales, own, routed)
  return available.length > 0 ? available : [locales[0]!]
}

/** Every required field of a group filled; a localized one in each of `locales`, or in the
 *  default locale. */
export const checkFields = (
  group: FieldGroup,
  defaultLocale: string,
  locales: ReadonlyArray<string>,
  data: Readonly<Record<string, unknown>>,
): Effect.Effect<void, CmsInvalid> =>
  Effect.gen(function* () {
    for (const [name, field] of Object.entries(group.fields)) {
      if (!field.required) continue
      const label = labelText(field.label, 'en')
      const value = data[name]
      if (!field.localized) {
        if (Array.isArray(value) ? value.length === 0 : !present(value))
          return yield* invalid(`"${label}" is required.`)
        continue
      }
      const values = isRecord(value) ? value : {}
      if (present(values[defaultLocale])) continue
      const missing = locales.find((locale) => !present(values[locale]))
      if (missing !== undefined) return yield* invalid(`"${label}" is required in ${missing}.`)
    }
  })

/** Publishing a page needs every section's required fields filled. */
export const checkRequired = (
  definitions: CmsDefinitions,
  contentLocales: ReadonlyArray<string>,
  document: PageDocument,
): Effect.Effect<void, CmsInvalid> =>
  Effect.gen(function* () {
    const locales = requiredLocales(contentLocales, document.locales, true)
    for (const [index, section] of document.sections.entries()) {
      const type = definitions.sections[section.type]
      if (!type)
        return yield* invalid(`Section ${index + 1} has an unknown type "${section.type}".`)
      yield* checkFields(type, contentLocales[0]!, locales, section.data).pipe(
        Effect.mapError((error) =>
          invalid(`Section ${index + 1} (${labelText(type.label, 'en')}): ${error.message}`),
        ),
      )
    }
  })
