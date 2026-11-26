import type { Field, FieldGroup, ListItem, PageLocale } from './api.ts'

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const listItems = (value: unknown): ReadonlyArray<ListItem> =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ListItem =>
          isRecord(item) && typeof item.id === 'string' && isRecord(item.data),
      )
    : []

export const emptyLocale = (path = ''): PageLocale => ({
  path,
  available: false,
  seo: { title: '', description: '', image: null, noindex: false },
})

/** The content locales a document is available in, in content-locale order. A locale the
 *  document lacks is available only for items without paths (unrouted collections). */
export const availableLocales = (
  locales: ReadonlyArray<string>,
  own: Readonly<Record<string, PageLocale>>,
  routed: boolean,
) => locales.filter((locale) => own[locale]?.available ?? !routed)

/** The locale a list shows a document in: the default one when available there, else the
 *  first available one. */
export const listLocale = (locales: ReadonlyArray<string>, available: ReadonlyArray<string>) =>
  available.includes(locales[0]!) ? locales[0]! : (available[0] ?? locales[0]!)

export const mapFields = (
  group: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  map: (field: Field, value: unknown) => unknown,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(data)) {
    const field = Object.hasOwn(group.fields, name) ? group.fields[name] : undefined
    if (!field) continue
    out[name] =
      field.kind === 'list'
        ? listItems(value).map((item) => ({
            id: item.id,
            data: mapFields({ fields: field.item ?? {} }, item.data, map),
          }))
        : map(field, value)
  }
  return out
}

export const localizeData = (
  group: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  locale: string,
  fallback: string,
): Record<string, unknown> =>
  mapFields(group, data, (field, value) => {
    if (!field.localized) return value
    const values = isRecord(value) ? value : {}
    return values[locale] ?? values[fallback] ?? null
  })
