// Client-safe: the host's cms definitions (TSPACK-11). One file, imported by the host's server
// (`cms({ definitions })`) and admin (`cmsAdmin({ definitions })`) entries, so server validation
// and the admin's generated forms come from the same field definitions: section types,
// collections and site settings all use `Field`.
import { Schema } from 'effect'
import { linkProblem, maxSections } from './document-rules.ts'
import { isRecord, listItems } from './localize.ts'

/** Admin text: one string, or one per admin locale (`{ en: 'Title', sk: 'Nadpis' }`); English when the locale is missing. */
export type Label = string | Readonly<Record<string, string>>

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'number'
  | 'select'
  | 'boolean'
  | 'media'
  | 'link'
  | 'reference'
  | 'custom'
  | 'list'

const uuidString = Schema.String.check(Schema.isUUID())

/**
 * A link to a page, an item, a system page (by key) or a URL. It stores the reference, not the
 * path: the Read API resolves it to the target's current published path per locale.
 */
export const Link = Schema.Union([
  Schema.Struct({ type: Schema.Literal('page'), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal('item'), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal('system'), key: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('url'),
    url: Schema.String.check(Schema.isMaxLength(2000)),
  }),
])
export type Link = typeof Link.Type

/**
 * One field of a section type: its value schema (Effect Schema, validated on the server) and
 * the metadata the admin builds its form control from.
 */
export interface Field<T = unknown, K extends FieldKind = FieldKind> {
  readonly kind: K
  readonly label: Label
  readonly help?: Label
  /** Holds one value per content locale, edited in the language the editor's switch shows. */
  readonly localized: boolean
  /** Must hold a value (in the default content locale, if localized) to publish. */
  readonly required: boolean
  /** The admin widget; built-ins are named after their kind, others come from `cmsAdmin`. */
  readonly widget: string
  /** Schema of one value (one locale's value, for localized fields). */
  readonly schema: Schema.Decoder<T>
  /** `select`: the choices. */
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: Label }>
  /** `media`: which media the picker offers. */
  readonly accept?: 'image' | 'pdf'
  /** `number`: bounds, also shown by the widget. `list`: the least and most items. */
  readonly min?: number
  readonly max?: number
  /** `list`: the fields of one item. */
  readonly item?: Readonly<Record<string, Field>>
  /** `reference`: the collection whose items it points at, and whether it holds a list. */
  readonly collection?: string
  readonly many?: boolean
}

/** One item of a list field: a stable id and its fields' data, stored like a field group's. */
export interface ListItem {
  readonly id: string
  readonly data: Readonly<Record<string, unknown>>
}

/** A field a list item may hold: any kind but a list. */
export type ItemField = Field<unknown, Exclude<FieldKind, 'list'>>

export interface ListField<
  I extends Readonly<Record<string, ItemField>> = Readonly<Record<string, ItemField>>,
> extends Field<ReadonlyArray<ListItem>, 'list'> {
  readonly item: I
}

export const maxListItems = 100

interface FieldOptions {
  readonly label: Label
  readonly help?: Label
  readonly localized?: boolean
  readonly required?: boolean
  /** A custom widget registered in `cmsAdmin({ widgets })`, replacing the built-in one. */
  readonly widget?: string
}

const make = <T, K extends FieldKind>(
  kind: K,
  schema: Schema.Decoder<T>,
  options: FieldOptions,
  localized: boolean,
  extra: Partial<Field<T, K>> = {},
): Field<T, K> => ({
  kind,
  schema,
  label: options.label,
  ...(options.help === undefined ? {} : { help: options.help }),
  localized: options.localized ?? localized,
  required: options.required ?? false,
  widget: options.widget ?? kind,
  ...extra,
})

const text = (maxLength: number) => Schema.String.check(Schema.isMaxLength(maxLength))

/** Field builders. Text kinds are localized by default, the others are not. */
export const fields = {
  text: (o: FieldOptions & { readonly maxLength?: number }) =>
    make('text', text(o.maxLength ?? 300), o, true),
  textarea: (o: FieldOptions & { readonly maxLength?: number }) =>
    make('textarea', text(o.maxLength ?? 5000), o, true),
  /** HTML in a restricted format, sanitized by the server on every save. */
  richText: (o: FieldOptions) => make('richText', text(100_000), o, true),
  number: (o: FieldOptions & { readonly min?: number; readonly max?: number }) =>
    make(
      'number',
      Schema.Finite.check(
        Schema.isBetween({
          minimum: o.min ?? Number.MIN_SAFE_INTEGER,
          maximum: o.max ?? Number.MAX_SAFE_INTEGER,
        }),
      ),
      o,
      false,
      {
        ...(o.min === undefined ? {} : { min: o.min }),
        ...(o.max === undefined ? {} : { max: o.max }),
      },
    ),
  select: <const V extends string>(
    o: FieldOptions & {
      readonly options: readonly [
        { readonly value: V; readonly label: Label },
        ...{ readonly value: V; readonly label: Label }[],
      ]
    },
  ) =>
    make<V, 'select'>('select', Schema.Literals(o.options.map((x) => x.value)), o, false, {
      options: o.options,
    }),
  boolean: (o: FieldOptions) => make('boolean', Schema.Boolean, o, false),
  /** A media library id, picked with `MediaPicker`; the Read API resolves it. */
  media: (o: FieldOptions & { readonly accept?: 'image' | 'pdf' }) =>
    make('media', uuidString, o, false, {
      ...(o.accept ? { accept: o.accept } : {}),
    }),
  /** A link to a page, item, system page or URL (see `Link`). */
  link: (o: FieldOptions) => make('link', Link, o, false),
  /** Item id(s) of one collection; `many` holds an ordered list (at most 100). */
  reference: (o: FieldOptions & { readonly collection: string; readonly many?: boolean }) =>
    make<string | ReadonlyArray<string>, 'reference'>(
      'reference',
      o.many ? Schema.Array(uuidString).check(Schema.isMaxLength(100)) : uuidString,
      o,
      false,
      { collection: o.collection, many: o.many ?? false },
    ),
  /** Any value schema with a host widget (`cmsAdmin({ widgets: { [widget]: ... } })`). */
  custom: <T>(o: FieldOptions & { readonly widget: string; readonly schema: Schema.Decoder<T> }) =>
    make('custom', o.schema, o, false),
  /**
   * Repeated items in an order the editor sets, each with its own fields (any kind but a list,
   * localized or not per field). `min` and `max` bound the count (at most 100); `min` is
   * checked on publish.
   */
  list: <I extends Readonly<Record<string, ItemField>>>(
    o: Pick<FieldOptions, 'label' | 'help'> & {
      readonly item: I
      readonly min?: number
      readonly max?: number
    },
  ): ListField<I> => {
    const fail = (message: string) => {
      throw new Error(`cms definitions: the list "${labelText(o.label, 'en')}" ${message}.`)
    }
    const kinds: Array<[string, FieldKind]> = Object.entries(o.item).map(([k, f]) => [k, f.kind])
    const nested = kinds.find(([, kind]) => kind === 'list')
    if (nested) fail(`has the list "${nested[0]}" in its items`)
    if (kinds.length === 0) fail('needs at least one item field')
    const { item, min = 0, max = maxListItems } = o
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < 0 ||
      min > max ||
      max > maxListItems
    )
      fail(`needs whole item counts with 0 <= min <= max <= ${maxListItems}`)
    const schema = Schema.Array(
      Schema.Struct({ id: Schema.String, data: sectionDataSchema({ fields: item }) }),
    ).check(Schema.isMaxLength(max))
    return { ...make('list', schema, o, false, { min, max }), item }
  },
}

/** A group's fields and, named `<list>.<field>`, the item fields of its lists. */
export const allFields = (group: FieldGroup): Array<[string, Field]> =>
  Object.entries(group.fields).flatMap(([name, field]) => [
    [name, field] satisfies [string, Field],
    ...Object.entries(field.item ?? {}).map(([inner, itemField]): [string, Field] => [
      `${name}.${inner}`,
      itemField,
    ]),
  ])

/**
 * Every stored value of a group's fields with its field: one per locale of a localized field,
 * and those of list items, where `where` names the item (`"Cards", item 2: `).
 */
export const storedValues = (
  group: FieldGroup,
  data: Readonly<Record<string, unknown>>,
  where = '',
): Array<{ name: string; field: Field; value: unknown; where: string }> =>
  Object.entries(group.fields).flatMap(([name, field]) => {
    const value = data[name]
    if (field.kind === 'list')
      return listItems(value).flatMap((item, index) =>
        storedValues(
          { fields: field.item ?? {} },
          item.data,
          `${where}"${labelText(field.label, 'en')}", item ${index + 1}: `,
        ),
      )
    const values = field.localized && isRecord(value) ? Object.values(value) : [value]
    return values.map((one) => ({ name, field, value: one, where }))
  })

/** Anything holding a set of fields: a section type, a collection, the site settings. */
export interface FieldGroup {
  readonly fields: Readonly<Record<string, Field>>
}

export interface SectionType extends FieldGroup {
  readonly label: Label
}

/** A host-defined collection type (posts, team, testimonials, categories). */
export interface Collection extends FieldGroup {
  readonly label: Label
  /** Items get their own path, availability and SEO per content locale, like pages. */
  readonly routed?: boolean
  /** The field naming an item in lists and pickers; default: the first text field. */
  readonly titleField?: string
  /** Reference or select fields the admin list offers a filter for, in this order. */
  readonly filters?: ReadonlyArray<string>
}

export interface Menu {
  readonly label: Label
  /** How deep items nest, 1 to 3 (default 3). */
  readonly depth?: 1 | 2 | 3
}

export interface SystemPage {
  readonly label: Label
  /** The path per content locale the page is created with (`{ en: '/', it: '/' }`). */
  readonly paths: Readonly<Record<string, string>>
}

/** The `rich_text` section type cms ships; every host has it. */
export const richTextSection = {
  label: { en: 'Rich text', sk: 'Formátovaný text', it: 'Testo formattato' },
  fields: { body: fields.richText({ label: { en: 'Text', sk: 'Text', it: 'Testo' } }) },
} satisfies SectionType

/** The global SEO fields every host's site settings start with (TSPACK-11). */
export const siteSettingsFields = {
  siteName: fields.text({ label: { en: 'Site name', sk: 'Názov webu', it: 'Nome del sito' } }),
  titleTemplate: fields.text({
    label: { en: 'Title template', sk: 'Šablóna titulku', it: 'Modello del titolo' },
    help: {
      en: '"%s" stands for the page title, e.g. "%s | Example".',
      sk: '"%s" nahradí titulok stránky, napr. "%s | Príklad".',
      it: '"%s" sta per il titolo della pagina, ad es. "%s | Esempio".',
    },
  }),
  defaultImage: fields.media({
    label: {
      en: 'Default social image',
      sk: 'Predvolený obrázok na zdieľanie',
      it: 'Immagine predefinita per i social',
    },
    accept: 'image',
  }),
  twitterHandle: fields.text({
    label: { en: 'X (Twitter) handle', sk: 'Účet na X (Twitter)', it: 'Account X (Twitter)' },
    localized: false,
    maxLength: 50,
  }),
} satisfies Record<string, Field>

/** A starting point for a new page: its sections in order, prefilled. */
export interface PageTemplate<SectionKey extends string = string> {
  readonly label: Label
  readonly description?: Label
  /**
   * Data uses the stored shape: localized fields hold `{ [locale]: value }`. Media ids are
   * per database, so only prefill an image whose id the host seeds.
   */
  readonly sections: ReadonlyArray<{
    readonly type: SectionKey
    readonly data?: Readonly<Record<string, unknown>>
  }>
}

export interface CmsDefinitions {
  readonly sections: Readonly<Record<string, SectionType>> & {
    readonly rich_text: typeof richTextSection
  }
  readonly systemPages: Readonly<Record<string, SystemPage>>
  readonly collections: Readonly<Record<string, Collection>>
  /** The site settings singleton: the global SEO fields plus the host's. */
  readonly settings: FieldGroup
  readonly menus: Readonly<Record<string, Menu>>
  readonly templates: Readonly<Record<string, PageTemplate>>
}

const keyPattern = /^[a-z][a-z0-9_]*$/

/**
 * The host's cms definitions: section types, system pages, collections, site settings fields,
 * menus and page templates, all by key (`[a-z][a-z0-9_]*`). `rich_text` and the global SEO
 * settings are added. Pass the result to `cms()` and `cmsAdmin()`.
 */
export const defineCms = <
  const Sections extends Readonly<Record<string, SectionType>>,
  const SystemPages extends Readonly<Record<string, SystemPage>>,
  const Collections extends Readonly<Record<string, Collection>> = Record<never, never>,
  const Menus extends Readonly<Record<string, Menu>> = Record<never, never>,
>(definitions: {
  readonly sections: Sections
  readonly systemPages: SystemPages
  readonly collections?: Collections
  readonly settings?: Readonly<Record<string, Field>>
  readonly menus?: Menus
  readonly templates?: Readonly<
    Record<string, PageTemplate<Extract<keyof Sections, string> | 'rich_text'>>
  >
}) => {
  const sections = { rich_text: richTextSection, ...definitions.sections }
  const systemPages = definitions.systemPages
  const collections = definitions.collections ?? ({} as Collections)
  const menus = definitions.menus ?? ({} as Menus)
  const settings = { fields: { ...siteSettingsFields, ...definitions.settings } }
  const templates: Readonly<Record<string, PageTemplate>> = definitions.templates ?? {}
  const fail = (message: string) => {
    throw new Error(`cms definitions: ${message}`)
  }
  for (const key of [
    ...Object.keys(sections),
    ...Object.keys(systemPages),
    ...Object.keys(collections),
    ...Object.keys(menus),
    ...Object.keys(templates),
  ])
    if (!keyPattern.test(key)) fail(`"${key}" is not a valid key ([a-z][a-z0-9_]*).`)
  const groups: Array<[string, FieldGroup]> = [
    ...Object.entries(sections).map(([k, g]): [string, FieldGroup] => [`section type "${k}"`, g]),
    ...Object.entries(collections).map(([k, g]): [string, FieldGroup] => [`collection "${k}"`, g]),
    ['site settings', settings],
  ]
  for (const [owner, group] of groups)
    for (const [name, field] of allFields(group))
      if (field.kind === 'reference' && !Object.hasOwn(collections, field.collection ?? ''))
        fail(`field "${name}" of ${owner} references the unknown collection "${field.collection}".`)
  for (const [key, collection] of Object.entries(collections))
    if (collection.titleField !== undefined && !(collection.titleField in collection.fields))
      fail(`the title field "${collection.titleField}" of collection "${key}" is not a field.`)
  for (const [key, collection] of Object.entries(collections))
    for (const name of collection.filters ?? []) {
      const kind = Object.hasOwn(collection.fields, name)
        ? collection.fields[name]?.kind
        : undefined
      if (kind !== 'reference' && kind !== 'select')
        fail(`the filter "${name}" of collection "${key}" is not a reference or select field.`)
    }
  for (const [key, template] of Object.entries(templates)) {
    if (template.sections.length > maxSections)
      fail(
        `template "${key}" has ${template.sections.length} sections; a page holds at most ${maxSections}.`,
      )
    template.sections.forEach(({ type, data = {} }, index) => {
      const owner = `template "${key}", section ${index + 1}`
      const sectionType = Object.hasOwn(sections, type) ? sections[type] : undefined
      if (!sectionType) return fail(`${owner} names the unknown section type "${type}".`)
      try {
        Schema.decodeUnknownSync(sectionDataSchema(sectionType))(data, {
          onExcessProperty: 'error',
        })
      } catch (error) {
        fail(
          `${owner} ("${type}") has invalid data: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      for (const { name, field, value, where } of storedValues(sectionType, data)) {
        if (field.kind !== 'link' || !Schema.is(Link)(value)) continue
        const problem = linkProblem({ systemPages }, value)
        if (problem) fail(`${owner} ("${type}") ${where}field "${name}": ${problem}`)
      }
    })
  }
  return { sections, systemPages, collections, settings, menus, templates } satisfies CmsDefinitions
}

/** The field naming a collection's items: `titleField`, else the first text field. */
export const titleFieldOf = (collection: Collection) =>
  collection.titleField ?? Object.entries(collection.fields).find(([, f]) => f.kind === 'text')?.[0]

/** The label in the admin locale, else English, else the first one. */
export const labelText = (label: Label | undefined, locale: string) =>
  label === undefined
    ? ''
    : typeof label === 'string'
      ? label
      : (label[locale] ?? label.en ?? Object.values(label)[0] ?? '')

/** The stored shape of a field group's data: localized fields hold `{ [locale]: value }`. */
export const sectionDataSchema = (type: FieldGroup) =>
  Schema.Struct(
    Object.fromEntries(
      Object.entries(type.fields).map(([name, field]) => [
        name,
        Schema.optionalKey(
          Schema.NullOr(
            field.localized
              ? Schema.Record(Schema.String, Schema.NullOr(field.schema))
              : field.schema,
          ),
        ),
      ]),
    ),
  )
