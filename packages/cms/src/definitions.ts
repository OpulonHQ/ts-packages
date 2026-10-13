// Client-safe: the host's cms definitions (TSPACK-11). One file, imported by the host's server
// (`cms({ definitions })`) and admin (`cmsAdmin({ definitions })`) entries, so server validation
// and the admin's generated forms come from the same field definitions: section types,
// collections and site settings all use `Field`.
import { Schema } from 'effect'

/** Admin text: one string, or one per admin locale (`{ en: 'Title', sk: 'Nadpis' }`). */
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
export interface Field<T = unknown> {
  readonly kind: FieldKind
  readonly label: Label
  readonly help?: Label
  /** Holds one value per content locale, edited in locale tabs. */
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
  /** `number`: bounds, also shown by the widget. */
  readonly min?: number
  readonly max?: number
  /** `reference`: the collection whose items it points at, and whether it holds a list. */
  readonly collection?: string
  readonly many?: boolean
}

interface FieldOptions {
  readonly label: Label
  readonly help?: Label
  readonly localized?: boolean
  readonly required?: boolean
  /** A custom widget registered in `cmsAdmin({ widgets })`, replacing the built-in one. */
  readonly widget?: string
}

const make = <T>(
  kind: FieldKind,
  schema: Schema.Decoder<T>,
  options: FieldOptions,
  localized: boolean,
  extra: Partial<Field<T>> = {},
): Field<T> => ({
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
    make<V>('select', Schema.Literals(o.options.map((x) => x.value)), o, false, {
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
    make<string | ReadonlyArray<string>>(
      'reference',
      o.many ? Schema.Array(uuidString).check(Schema.isMaxLength(100)) : uuidString,
      o,
      false,
      { collection: o.collection, many: o.many ?? false },
    ),
  /** Any value schema with a host widget (`cmsAdmin({ widgets: { [widget]: ... } })`). */
  custom: <T>(o: FieldOptions & { readonly widget: string; readonly schema: Schema.Decoder<T> }) =>
    make('custom', o.schema, o, false),
}

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
  label: { en: 'Rich text', sk: 'Formátovaný text' },
  fields: { body: fields.richText({ label: { en: 'Text', sk: 'Text' } }) },
} satisfies SectionType

/** The global SEO fields every host's site settings start with (TSPACK-11). */
export const siteSettingsFields = {
  siteName: fields.text({ label: { en: 'Site name', sk: 'Názov webu' } }),
  titleTemplate: fields.text({
    label: { en: 'Title template', sk: 'Šablóna titulku' },
    help: {
      en: '"%s" stands for the page title, e.g. "%s | Example".',
      sk: '"%s" nahradí titulok stránky, napr. "%s | Príklad".',
    },
  }),
  defaultImage: fields.media({
    label: { en: 'Default social image', sk: 'Predvolený obrázok na zdieľanie' },
    accept: 'image',
  }),
  twitterHandle: fields.text({
    label: { en: 'X (Twitter) handle', sk: 'Účet na X (Twitter)' },
    localized: false,
    maxLength: 50,
  }),
} satisfies Record<string, Field>

export interface CmsDefinitions {
  readonly sections: Readonly<Record<string, SectionType>> & {
    readonly rich_text: typeof richTextSection
  }
  readonly systemPages: Readonly<Record<string, SystemPage>>
  readonly collections: Readonly<Record<string, Collection>>
  /** The site settings singleton: the global SEO fields plus the host's. */
  readonly settings: FieldGroup
  readonly menus: Readonly<Record<string, Menu>>
}

const keyPattern = /^[a-z][a-z0-9_]*$/

/**
 * The host's cms definitions: section types, system pages, collections, site settings fields
 * and menus, all by key (`[a-z][a-z0-9_]*`). `rich_text` and the global SEO settings are added.
 * Pass the result to `cms()` and `cmsAdmin()`.
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
}) => {
  const sections = { rich_text: richTextSection, ...definitions.sections }
  const systemPages = definitions.systemPages
  const collections = definitions.collections ?? ({} as Collections)
  const menus = definitions.menus ?? ({} as Menus)
  const settings = { fields: { ...siteSettingsFields, ...definitions.settings } }
  const fail = (message: string) => {
    throw new Error(`cms definitions: ${message}`)
  }
  for (const key of [
    ...Object.keys(sections),
    ...Object.keys(systemPages),
    ...Object.keys(collections),
    ...Object.keys(menus),
  ])
    if (!keyPattern.test(key)) fail(`"${key}" is not a valid key ([a-z][a-z0-9_]*).`)
  const groups: Array<[string, FieldGroup]> = [
    ...Object.entries(sections).map(([k, g]): [string, FieldGroup] => [`section type "${k}"`, g]),
    ...Object.entries(collections).map(([k, g]): [string, FieldGroup] => [`collection "${k}"`, g]),
    ['site settings', settings],
  ]
  for (const [owner, group] of groups)
    for (const [name, field] of Object.entries(group.fields))
      if (field.kind === 'reference' && !Object.hasOwn(collections, field.collection ?? ''))
        fail(`field "${name}" of ${owner} references the unknown collection "${field.collection}".`)
  for (const [key, collection] of Object.entries(collections))
    if (collection.titleField !== undefined && !(collection.titleField in collection.fields))
      fail(`the title field "${collection.titleField}" of collection "${key}" is not a field.`)
  return { sections, systemPages, collections, settings, menus } satisfies CmsDefinitions
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
