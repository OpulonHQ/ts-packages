// Client-safe: the cms HttpApi group, its catalogs, document schemas and the definitions
// builders (TSPACK-11). Imported by the admin build and the host's definitions file, so no
// server-only imports here.
import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { Link } from './definitions.ts'

export * from './definitions.ts'

export const cmsPermissions = [
  'cms.pages.view',
  /** Create pages, edit drafts, delete pages that are not system pages. */
  'cms.pages.edit',
  /** Publish and unpublish. */
  'cms.pages.publish',
  'cms.collections.view',
  /** Create items, edit drafts, delete items. */
  'cms.collections.edit',
  'cms.collections.publish',
  /** Site settings and menus. */
  'cms.site.view',
  'cms.site.edit',
  'cms.site.publish',
  'cms.redirects.view',
  /** Create, edit, delete and import redirects. */
  'cms.redirects.edit',
] as const

/** The publish family (TSPACK-11); drafts are not audited. */
export const cmsAuditActions = [
  { key: 'cms.page.published', subject: 'page' },
  { key: 'cms.page.unpublished', subject: 'page' },
  { key: 'cms.page.deleted', subject: 'page' },
  { key: 'cms.item.published', subject: 'item' },
  { key: 'cms.item.unpublished', subject: 'item' },
  { key: 'cms.item.deleted', subject: 'item' },
  { key: 'cms.settings.published', subject: 'settings' },
  { key: 'cms.settings.unpublished', subject: 'settings' },
  { key: 'cms.menu.published', subject: 'menu' },
  { key: 'cms.menu.unpublished', subject: 'menu' },
  { key: 'cms.redirect.created', subject: 'redirect' },
  { key: 'cms.redirect.updated', subject: 'redirect' },
  { key: 'cms.redirect.deleted', subject: 'redirect' },
  /** One event per CSV import, with the counts in `context`. */
  { key: 'cms.redirect.imported', subject: 'redirect' },
] as const

/** A page in one content locale. `path` is locale-relative (`/`, `/about`); the public URL
 *  adds the locale prefix. Only `available` locales are published at their path. */
export const PageLocale = Schema.Struct({
  path: Schema.String,
  available: Schema.Boolean,
  seo: Schema.Struct({
    title: Schema.String,
    description: Schema.String,
    /** Media id of the OG image. */
    image: Schema.NullOr(Schema.String),
    noindex: Schema.Boolean,
  }),
})
export type PageLocale = typeof PageLocale.Type

/** One section: `data` holds the section type's fields (localized ones as `{ [locale]: v }`). */
export const Section = Schema.Struct({
  /** Stable within the page (uuid). */
  id: Schema.String,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type Section = typeof Section.Type

/** A page's draft or published document: one JSON document, sections inside. */
export const PageDocument = Schema.Struct({
  locales: Schema.Record(Schema.String, PageLocale),
  sections: Schema.Array(Section),
})
export type PageDocument = typeof PageDocument.Type

export const PageStatus = Schema.Literals(['draft', 'published', 'changed'])
/** `draft`: never published (or unpublished); `changed`: published, draft differs. */
export type PageStatus = typeof PageStatus.Type

export const PageSummary = Schema.Struct({
  id: Schema.String,
  /** The system page key, or null for an editor's page. */
  systemKey: Schema.NullOr(Schema.String),
  /** SEO title (else path) in the default content locale, from the draft. */
  title: Schema.String,
  path: Schema.String,
  status: PageStatus,
  updatedAt: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
})
export type PageSummary = typeof PageSummary.Type

export const Page = Schema.Struct({
  ...PageSummary.fields,
  draft: PageDocument,
  published: Schema.NullOr(PageDocument),
  /** The revision recorded by the last publish. */
  publishedRevisionId: Schema.NullOr(Schema.String),
})
export type Page = typeof Page.Type

/** A draft as a site renders it in one locale: localized fields resolved (with fallback). */
export const PagePreview = Schema.Struct({
  id: Schema.String,
  locale: Schema.String,
  path: Schema.String,
  seo: PageLocale.fields.seo,
  sections: Schema.Array(Section),
})
export type PagePreview = typeof PagePreview.Type

/** Status and publish bookkeeping every editable document shares. */
const documentState = {
  status: PageStatus,
  updatedAt: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
}

/** An item's draft or published document. `locales` carries path, availability and SEO per
 *  content locale like a page's; items of collections that are not routed have no paths. */
export const ItemDocument = Schema.Struct({
  locales: Schema.Record(Schema.String, PageLocale),
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type ItemDocument = typeof ItemDocument.Type

export const ItemSummary = Schema.Struct({
  id: Schema.String,
  collection: Schema.String,
  /** The title field (else SEO title, else path) in the default content locale, from the draft. */
  title: Schema.String,
  path: Schema.String,
  ...documentState,
})
export type ItemSummary = typeof ItemSummary.Type

export const Item = Schema.Struct({
  ...ItemSummary.fields,
  draft: ItemDocument,
  published: Schema.NullOr(ItemDocument),
  publishedRevisionId: Schema.NullOr(Schema.String),
})
export type Item = typeof Item.Type

export const ItemPreview = Schema.Struct({
  id: Schema.String,
  collection: Schema.String,
  locale: Schema.String,
  path: Schema.String,
  seo: PageLocale.fields.seo,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type ItemPreview = typeof ItemPreview.Type

/** The site settings' draft or published document. */
export const SettingsDocument = Schema.Struct({
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type SettingsDocument = typeof SettingsDocument.Type

export const SiteSettings = Schema.Struct({
  ...documentState,
  draft: SettingsDocument,
  published: Schema.NullOr(SettingsDocument),
  publishedRevisionId: Schema.NullOr(Schema.String),
})
export type SiteSettings = typeof SiteSettings.Type

export const SettingsPreview = Schema.Struct({
  locale: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export type SettingsPreview = typeof SettingsPreview.Type

/** One menu entry: a label per content locale, a link, and children (menus nest up to 3). */
export interface MenuItem {
  readonly id: string
  readonly label: Readonly<Record<string, string>>
  readonly link: Link
  readonly children: ReadonlyArray<MenuItem>
}
export const MenuItem = Schema.Struct({
  id: Schema.String,
  label: Schema.Record(Schema.String, Schema.String),
  link: Link,
  children: Schema.Array(Schema.suspend((): Schema.Codec<MenuItem> => MenuItem)),
})

export const MenuDocument = Schema.Struct({ items: Schema.Array(MenuItem) })
export type MenuDocument = typeof MenuDocument.Type

export const MenuSummary = Schema.Struct({ key: Schema.String, ...documentState })
export type MenuSummary = typeof MenuSummary.Type

export const Menu = Schema.Struct({
  ...MenuSummary.fields,
  draft: MenuDocument,
  published: Schema.NullOr(MenuDocument),
  publishedRevisionId: Schema.NullOr(Schema.String),
})
export type Menu = typeof Menu.Type

/** A menu entry in one locale: label resolved (with fallback), link resolved to an href
 *  (locale-relative path, or the URL; null when the target is not published there). */
export interface ResolvedMenuItem {
  readonly id: string
  readonly label: string
  readonly link: Link
  readonly href: string | null
  readonly children: ReadonlyArray<ResolvedMenuItem>
}
export const ResolvedMenuItem = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  link: Link,
  href: Schema.NullOr(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<ResolvedMenuItem> => ResolvedMenuItem)),
})

export const MenuPreview = Schema.Struct({
  key: Schema.String,
  locale: Schema.String,
  items: Schema.Array(ResolvedMenuItem),
})
export type MenuPreview = typeof MenuPreview.Type

/** The document failed validation against the definitions; `message` is for the editor. */
export class CmsInvalid extends Schema.TaggedError<CmsInvalid>()(
  'CmsInvalid',
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class CmsNotFound extends Schema.TaggedError<CmsNotFound>()(
  'CmsNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** A path taken by another page, deleting a system page, or a redirect that would repeat a
 *  path or loop. */
export class CmsConflict extends Schema.TaggedError<CmsConflict>()(
  'CmsConflict',
  {
    reason: Schema.Literals(['path_taken', 'system_page', 'redirect_taken', 'redirect_loop']),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export const RedirectStatus = Schema.Literals([301, 302])
export type RedirectStatus = typeof RedirectStatus.Type

/** A redirect as an editor writes it. Paths are locale-relative like page paths (`/old`), but
 *  any characters a URL path allows; a trailing slash is dropped. */
export const RedirectInput = Schema.Struct({
  locale: Schema.String,
  from: Schema.String,
  to: Schema.String,
  status: RedirectStatus,
})
export type RedirectInput = typeof RedirectInput.Type

/** An exact-path redirect in one content locale. `auto`: created by a path change on publish. */
export const Redirect = Schema.Struct({
  id: Schema.String,
  ...RedirectInput.fields,
  auto: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Redirect = typeof Redirect.Type

/** Upper bounds of a CSV import: characters of the file and data rows. */
export const redirectImportLimits = { maxChars: 1_000_000, maxRows: 5000 } as const

/** What a CSV import did. `row` counts the header as row 1, like a spreadsheet. */
export const RedirectImportResult = Schema.Struct({
  created: Schema.Number,
  skipped: Schema.Number,
  errors: Schema.Array(Schema.Struct({ row: Schema.Number, message: Schema.String })),
})
export type RedirectImportResult = typeof RedirectImportResult.Type

const id = { id: Schema.String }
const collection = { collection: Schema.String }
const key = { key: Schema.String }
const localeQuery = { locale: Schema.optionalKey(Schema.String) }

export const CmsGroup = HttpApiGroup.make('cms')
  .add(
    HttpApiEndpoint.get('listPages', '/pages', {
      success: Schema.Struct({ rows: Schema.Array(PageSummary), total: Schema.Number }),
    }).annotate(Policy, 'cms.pages.view'),
  )
  .add(
    HttpApiEndpoint.get('getPage', '/pages/:id', {
      params: id,
      success: Page,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.pages.view'),
  )
  .add(
    HttpApiEndpoint.post('createPage', '/pages', {
      payload: PageDocument,
      success: Page,
      error: [CmsInvalid, CmsConflict],
    }).annotate(Policy, 'cms.pages.edit'),
  )
  .add(
    HttpApiEndpoint.put('saveDraft', '/pages/:id/draft', {
      params: id,
      payload: PageDocument,
      success: Page,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.pages.edit'),
  )
  .add(
    HttpApiEndpoint.delete('deletePage', '/pages/:id', {
      params: id,
      error: [CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.pages.edit'),
  )
  .add(
    HttpApiEndpoint.post('publishPage', '/pages/:id/publish', {
      params: id,
      success: Page,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.pages.publish'),
  )
  .add(
    HttpApiEndpoint.post('unpublishPage', '/pages/:id/unpublish', {
      params: id,
      success: Page,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.pages.publish'),
  )
  .add(
    // Preview: an admin session reads the draft; answered `private, no-store`.
    HttpApiEndpoint.get('previewPage', '/pages/:id/preview', {
      params: id,
      query: { locale: Schema.optionalKey(Schema.String) },
      success: PagePreview,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.pages.view'),
  )
  .add(
    HttpApiEndpoint.get('listItems', '/collections/:collection/items', {
      params: collection,
      success: Schema.Struct({ rows: Schema.Array(ItemSummary), total: Schema.Number }),
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.view'),
  )
  .add(
    HttpApiEndpoint.post('createItem', '/collections/:collection/items', {
      params: collection,
      payload: ItemDocument,
      success: Item,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.collections.edit'),
  )
  .add(
    HttpApiEndpoint.get('getItem', '/items/:id', {
      params: id,
      success: Item,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.view'),
  )
  .add(
    HttpApiEndpoint.put('saveItemDraft', '/items/:id/draft', {
      params: id,
      payload: ItemDocument,
      success: Item,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.collections.edit'),
  )
  .add(
    HttpApiEndpoint.delete('deleteItem', '/items/:id', {
      params: id,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.edit'),
  )
  .add(
    HttpApiEndpoint.post('publishItem', '/items/:id/publish', {
      params: id,
      success: Item,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.collections.publish'),
  )
  .add(
    HttpApiEndpoint.post('unpublishItem', '/items/:id/unpublish', {
      params: id,
      success: Item,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.publish'),
  )
  .add(
    HttpApiEndpoint.get('previewItem', '/items/:id/preview', {
      params: id,
      query: localeQuery,
      success: ItemPreview,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.view'),
  )
  .add(
    HttpApiEndpoint.get('getSettings', '/settings', { success: SiteSettings }).annotate(
      Policy,
      'cms.site.view',
    ),
  )
  .add(
    HttpApiEndpoint.put('saveSettingsDraft', '/settings/draft', {
      payload: SettingsDocument,
      success: SiteSettings,
      error: CmsInvalid,
    }).annotate(Policy, 'cms.site.edit'),
  )
  .add(
    HttpApiEndpoint.post('publishSettings', '/settings/publish', {
      success: SiteSettings,
      error: CmsInvalid,
    }).annotate(Policy, 'cms.site.publish'),
  )
  .add(
    HttpApiEndpoint.post('unpublishSettings', '/settings/unpublish', {
      success: SiteSettings,
    }).annotate(Policy, 'cms.site.publish'),
  )
  .add(
    HttpApiEndpoint.get('previewSettings', '/settings/preview', {
      query: localeQuery,
      success: SettingsPreview,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.get('listMenus', '/menus', {
      success: Schema.Struct({ rows: Schema.Array(MenuSummary), total: Schema.Number }),
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.get('getMenu', '/menus/:key', {
      params: key,
      success: Menu,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.put('saveMenuDraft', '/menus/:key/draft', {
      params: key,
      payload: MenuDocument,
      success: Menu,
      error: [CmsInvalid, CmsNotFound],
    }).annotate(Policy, 'cms.site.edit'),
  )
  .add(
    HttpApiEndpoint.post('publishMenu', '/menus/:key/publish', {
      params: key,
      success: Menu,
      error: [CmsInvalid, CmsNotFound],
    }).annotate(Policy, 'cms.site.publish'),
  )
  .add(
    HttpApiEndpoint.post('unpublishMenu', '/menus/:key/unpublish', {
      params: key,
      success: Menu,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.publish'),
  )
  .add(
    HttpApiEndpoint.get('previewMenu', '/menus/:key/preview', {
      params: key,
      query: localeQuery,
      success: MenuPreview,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.get('listRedirects', '/redirects', {
      success: Schema.Struct({ rows: Schema.Array(Redirect), total: Schema.Number }),
    }).annotate(Policy, 'cms.redirects.view'),
  )
  .add(
    HttpApiEndpoint.post('createRedirect', '/redirects', {
      payload: RedirectInput,
      success: Redirect,
      error: [CmsInvalid, CmsConflict],
    }).annotate(Policy, 'cms.redirects.edit'),
  )
  .add(
    HttpApiEndpoint.put('updateRedirect', '/redirects/:id', {
      params: id,
      payload: RedirectInput,
      success: Redirect,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.redirects.edit'),
  )
  .add(
    HttpApiEndpoint.delete('deleteRedirect', '/redirects/:id', {
      params: id,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.redirects.edit'),
  )
  .add(
    // The file's text, read by the admin; rows are validated one by one.
    HttpApiEndpoint.post('importRedirects', '/redirects/import', {
      payload: Schema.Struct({
        csv: Schema.String.check(Schema.isMaxLength(redirectImportLimits.maxChars)),
      }),
      success: RedirectImportResult,
      error: CmsInvalid,
    }).annotate(Policy, 'cms.redirects.edit'),
  )
  .middleware(Authorization)
