import { Authorization, Policy, Public } from '@opulonjs/core/api'
import { ResolvedMedia } from '@opulonjs/media/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import * as HttpApiSchema from 'effect/http-api/HttpApiSchema'
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
  { key: 'cms.page.restored', subject: 'page' },
  { key: 'cms.page.published', subject: 'page' },
  { key: 'cms.page.unpublished', subject: 'page' },
  { key: 'cms.page.deleted', subject: 'page' },
  { key: 'cms.item.restored', subject: 'item' },
  { key: 'cms.item.published', subject: 'item' },
  { key: 'cms.item.unpublished', subject: 'item' },
  { key: 'cms.item.deleted', subject: 'item' },
  { key: 'cms.settings.restored', subject: 'settings' },
  { key: 'cms.settings.published', subject: 'settings' },
  { key: 'cms.settings.unpublished', subject: 'settings' },
  { key: 'cms.menu.restored', subject: 'menu' },
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

/** A redirect as an editor writes it. Paths are locale-relative URL paths (`/old`), stored
 *  decoded and canonical: percent-escapes decoded, dot segments resolved, repeated and trailing
 *  slashes dropped. */
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

export const revisionPageSize = 25
export const RevisionSummary = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  author: Schema.Struct({ id: Schema.NullOr(Schema.String), name: Schema.String }),
})
export type RevisionSummary = typeof RevisionSummary.Type
export const RevisionList = Schema.Struct({
  rows: Schema.Array(RevisionSummary),
  total: Schema.Number,
})
export type RevisionList = typeof RevisionList.Type
export const RevisionQuery = {
  page: Schema.optionalKey(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 10_000 }),
    ),
  ),
}
export const PageRevision = Schema.Struct({ ...RevisionSummary.fields, document: PageDocument })
export type PageRevision = typeof PageRevision.Type
export const ItemRevision = Schema.Struct({ ...RevisionSummary.fields, document: ItemDocument })
export type ItemRevision = typeof ItemRevision.Type
export const SettingsRevision = Schema.Struct({
  ...RevisionSummary.fields,
  document: SettingsDocument,
})
export type SettingsRevision = typeof SettingsRevision.Type
export const MenuRevision = Schema.Struct({ ...RevisionSummary.fields, document: MenuDocument })
export type MenuRevision = typeof MenuRevision.Type

const id = { id: Schema.String }
const collection = { collection: Schema.String }
const key = { key: Schema.String }
const localeQuery = { locale: Schema.optionalKey(Schema.String) }

export const CmsGroup = HttpApiGroup.make('cms')
  .add(
    HttpApiEndpoint.get('listPageRevisions', '/pages/:id/revisions', {
      params: id,
      query: RevisionQuery,
      success: RevisionList,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.pages.view'),
  )
  .add(
    HttpApiEndpoint.get('getPageRevision', '/pages/:id/revisions/:revisionId', {
      params: { ...id, revisionId: Schema.String },
      success: PageRevision,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.pages.view'),
  )
  .add(
    HttpApiEndpoint.post('restorePageRevision', '/pages/:id/revisions/:revisionId/restore', {
      params: { ...id, revisionId: Schema.String },
      success: Page,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.pages.publish'),
  )
  .add(
    HttpApiEndpoint.get('listItemRevisions', '/items/:id/revisions', {
      params: id,
      query: RevisionQuery,
      success: RevisionList,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.view'),
  )
  .add(
    HttpApiEndpoint.get('getItemRevision', '/items/:id/revisions/:revisionId', {
      params: { ...id, revisionId: Schema.String },
      success: ItemRevision,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.collections.view'),
  )
  .add(
    HttpApiEndpoint.post('restoreItemRevision', '/items/:id/revisions/:revisionId/restore', {
      params: { ...id, revisionId: Schema.String },
      success: Item,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.collections.publish'),
  )
  .add(
    HttpApiEndpoint.get('listSettingsRevisions', '/settings/revisions', {
      query: RevisionQuery,
      success: RevisionList,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.get('getSettingsRevision', '/settings/revisions/:revisionId', {
      params: { revisionId: Schema.String },
      success: SettingsRevision,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.post('restoreSettingsRevision', '/settings/revisions/:revisionId/restore', {
      params: { revisionId: Schema.String },
      success: SiteSettings,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.site.publish'),
  )
  .add(
    HttpApiEndpoint.get('listMenuRevisions', '/menus/:key/revisions', {
      params: key,
      query: RevisionQuery,
      success: RevisionList,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.get('getMenuRevision', '/menus/:key/revisions/:revisionId', {
      params: { ...key, revisionId: Schema.String },
      success: MenuRevision,
      error: CmsNotFound,
    }).annotate(Policy, 'cms.site.view'),
  )
  .add(
    HttpApiEndpoint.post('restoreMenuRevision', '/menus/:key/revisions/:revisionId/restore', {
      params: { ...key, revisionId: Schema.String },
      success: Menu,
      error: [CmsInvalid, CmsConflict, CmsNotFound],
    }).annotate(Policy, 'cms.site.publish'),
  )
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
    HttpApiEndpoint.post('importRedirects', '/redirects/import', {
      payload: Schema.Struct({
        csv: Schema.String.check(Schema.isMaxLength(redirectImportLimits.maxChars)),
      }),
      success: RedirectImportResult,
      error: CmsInvalid,
    }).annotate(Policy, 'cms.redirects.edit'),
  )
  .middleware(Authorization)

export { ResolvedMedia }

export { publicPath, readCacheControl } from './public.ts'

const href = { href: Schema.NullOr(Schema.String) }
/** A link field's value in the Read API: the stored link plus its public href (null when the
 *  target is not published in the locale). */
export const ResolvedLink = Schema.Union([
  Schema.Struct({ type: Schema.Literal('page'), id: Schema.String, ...href }),
  Schema.Struct({ type: Schema.Literal('item'), id: Schema.String, ...href }),
  Schema.Struct({ type: Schema.Literal('system'), key: Schema.String, ...href }),
  Schema.Struct({ type: Schema.Literal('url'), url: Schema.String, ...href }),
])
export type ResolvedLink = typeof ResolvedLink.Type

/** One locale a page or item is published in, for hreflang and the locale switcher. */
export const Alternate = Schema.Struct({ locale: Schema.String, path: Schema.String })
export type Alternate = typeof Alternate.Type

/** SEO of a page or item in one locale; `image` resolved (null when unset or gone). */
export const PublicSeo = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  image: Schema.NullOr(ResolvedMedia),
  noindex: Schema.Boolean,
})
export type PublicSeo = typeof PublicSeo.Type

/**
 * A field group's data in one locale: localized fields hold that locale's value (falling back
 * to the default locale), media fields a `ResolvedMedia` (null when gone), link fields a
 * `ResolvedLink`; reference fields keep item ids (read them with `collections/:key?ids=`).
 */
export const PublicData = Schema.Record(Schema.String, Schema.Unknown)
export type PublicData = typeof PublicData.Type

const routedFields = {
  id: Schema.String,
  locale: Schema.String,
  /** The document's public path in `locale`: the canonical. */
  path: Schema.String,
  /** Every locale it is published in, this one included, in content locale order. */
  alternates: Schema.Array(Alternate),
  seo: PublicSeo,
  publishedAt: Schema.String,
}

export const ResolvedPage = Schema.Struct({
  kind: Schema.Literal('page'),
  ...routedFields,
  /** The system page key, or null for an editor's page. */
  systemKey: Schema.NullOr(Schema.String),
  sections: Schema.Array(
    Schema.Struct({ id: Schema.String, type: Schema.String, data: PublicData }),
  ),
})
export type ResolvedPage = typeof ResolvedPage.Type

export const ResolvedItem = Schema.Struct({
  kind: Schema.Literal('item'),
  ...routedFields,
  collection: Schema.String,
  data: PublicData,
})
export type ResolvedItem = typeof ResolvedItem.Type

/** The host answers with `status` and a Location of `to` (a public path). */
export const ResolvedRedirect = Schema.Struct({
  kind: Schema.Literal('redirect'),
  locale: Schema.String,
  to: Schema.String,
  status: RedirectStatus,
})
export type ResolvedRedirect = typeof ResolvedRedirect.Type

export const ResolvedNotFound = Schema.Struct({
  kind: Schema.Literal('not_found'),
  locale: Schema.String,
})
export type ResolvedNotFound = typeof ResolvedNotFound.Type

/** What `resolve?path=` answers, always with status 200 (TSPACK-19 decision 1). */
export const ResolveResult = Schema.Union([
  ResolvedPage,
  ResolvedItem,
  ResolvedRedirect,
  ResolvedNotFound,
])
export type ResolveResult = typeof ResolveResult.Type

/** What `site?locale=` answers: the published settings and menus in one locale. */
export const PublicSite = Schema.Struct({
  locale: Schema.String,
  /** The content locales, the default first. */
  locales: Schema.Array(Schema.String),
  /** The published site settings (empty until published), shaped like `PublicData`. */
  settings: PublicData,
  /** Every declared menu by key, hrefs as public paths; an unpublished menu has no items. */
  menus: Schema.Record(Schema.String, Schema.Array(ResolvedMenuItem)),
  /** Every system page's public path in the locale; null when not published there. */
  systemPages: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
})
export type PublicSite = typeof PublicSite.Type

/** A published item in a collection list. */
export const PublicItem = Schema.Struct({
  id: Schema.String,
  collection: Schema.String,
  /** Public path in the locale; null in collections that are not routed. */
  path: Schema.NullOr(Schema.String),
  data: PublicData,
  publishedAt: Schema.String,
})
export type PublicItem = typeof PublicItem.Type

export const PublicItems = Schema.Struct({
  rows: Schema.Array(PublicItem),
  total: Schema.Number,
  page: Schema.Number,
  perPage: Schema.Number,
})
export type PublicItems = typeof PublicItems.Type

/** Query of `collections/:key`. */
export const PublicItemsQuery = {
  locale: Schema.optionalKey(Schema.String),
  /** 1-based (default 1). */
  page: Schema.optionalKey(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 10_000 }),
    ),
  ),
  /** 1 to 100 (default 20). */
  perPage: Schema.optionalKey(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  /** By publish time: `newest` (default) or `oldest` first. */
  sort: Schema.optionalKey(Schema.Literals(['newest', 'oldest'])),
  /** Only items whose reference fields hold this item id. */
  ref: Schema.optionalKey(Schema.String),
  /** Only these item ids, comma-separated (at most 100). */
  ids: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(3800))),
}

const xml = Schema.String.pipe(HttpApiSchema.asText({ contentType: 'application/xml' }))

/**
 * The Read API under `/api/cms`, public on purpose (no auth). Every successful answer carries
 * `readCacheControl` and a comma-separated `Cache-Tag` header.
 */
export const CmsReadGroup = HttpApiGroup.make('cms.read')
  .add(
    HttpApiEndpoint.get('resolve', '/resolve', {
      query: { path: Schema.String.check(Schema.isMaxLength(2048)) },
      success: ResolveResult,
    }),
  )
  .add(
    HttpApiEndpoint.get('site', '/site', {
      query: localeQuery,
      success: PublicSite,
      error: CmsInvalid,
    }),
  )
  .add(
    HttpApiEndpoint.get('collection', '/collections/:collection', {
      params: collection,
      query: PublicItemsQuery,
      success: PublicItems,
      error: [CmsInvalid, CmsNotFound],
    }),
  )

  .add(HttpApiEndpoint.get('sitemapIndex', '/sitemap.xml', { success: xml }))
  .add(
    HttpApiEndpoint.get('sitemap', '/sitemaps/:file', {
      params: { file: Schema.String },
      success: xml,
      error: CmsNotFound,
    }),
  )
  .annotate(Public, true)
