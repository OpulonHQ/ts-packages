// Client-safe: the host's cms definitions (TSPACK-11). One file, imported by the host's server
// (`cms({ definitions })`) and admin (`cmsAdmin({ definitions })`) entries, so server validation
// and the admin's generated forms come from the same field definitions. Collections, site
// settings and menus (next slices) reuse `Field` and add their own keys to `CmsDefinitions`.
import { Schema } from 'effect'

/** Admin text: one string, or one per admin locale (`{ en: 'Title', sk: 'Nadpis' }`). */
export type Label = string | Readonly<Record<string, string>>

export type FieldKind =
  'text' | 'textarea' | 'richText' | 'number' | 'select' | 'boolean' | 'media' | 'custom'

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
    make('media', Schema.String.check(Schema.isUUID()), o, false, {
      ...(o.accept ? { accept: o.accept } : {}),
    }),
  /** Any value schema with a host widget (`cmsAdmin({ widgets: { [widget]: ... } })`). */
  custom: <T>(o: FieldOptions & { readonly widget: string; readonly schema: Schema.Decoder<T> }) =>
    make('custom', o.schema, o, false),
}

export interface SectionType {
  readonly label: Label
  readonly fields: Readonly<Record<string, Field>>
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

export interface CmsDefinitions {
  readonly sections: Readonly<Record<string, SectionType>> & {
    readonly rich_text: typeof richTextSection
  }
  readonly systemPages: Readonly<Record<string, SystemPage>>
}

/**
 * The host's cms definitions: section types and system pages (by key). Keys are
 * `[a-z][a-z0-9_]*`; `rich_text` is added. Pass the result to `cms()` and `cmsAdmin()`.
 */
export const defineCms = <
  const Sections extends Readonly<Record<string, SectionType>>,
  const SystemPages extends Readonly<Record<string, SystemPage>>,
>(definitions: {
  readonly sections: Sections
  readonly systemPages: SystemPages
}) => {
  const sections = { rich_text: richTextSection, ...definitions.sections }
  const systemPages = definitions.systemPages
  for (const key of [...Object.keys(sections), ...Object.keys(systemPages)])
    if (!/^[a-z][a-z0-9_]*$/.test(key))
      throw new Error(`cms definitions: "${key}" is not a valid key ([a-z][a-z0-9_]*).`)
  return { sections, systemPages } satisfies CmsDefinitions
}

/** The label in the admin locale, else English, else the first one. */
export const labelText = (label: Label | undefined, locale: string) =>
  label === undefined
    ? ''
    : typeof label === 'string'
      ? label
      : (label[locale] ?? label.en ?? Object.values(label)[0] ?? '')

/** The stored shape of a section's data: localized fields hold `{ [locale]: value }`. */
export const sectionDataSchema = (type: SectionType) =>
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
