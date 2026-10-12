// Client-safe: the cms HttpApi group, its catalogs, document schemas and the definitions
// builders (TSPACK-11). Imported by the admin build and the host's definitions file, so no
// server-only imports here.
import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export * from './definitions.ts'

export const cmsPermissions = [
  'cms.pages.view',
  /** Create pages, edit drafts, delete pages that are not system pages. */
  'cms.pages.edit',
  /** Publish and unpublish. */
  'cms.pages.publish',
] as const

/** The publish family (TSPACK-11); drafts are not audited. */
export const cmsAuditActions = [
  { key: 'cms.page.published', subject: 'page' },
  { key: 'cms.page.unpublished', subject: 'page' },
  { key: 'cms.page.deleted', subject: 'page' },
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

/** A path taken by another page, or deleting a system page. */
export class CmsConflict extends Schema.TaggedError<CmsConflict>()(
  'CmsConflict',
  { reason: Schema.Literals(['path_taken', 'system_page']), message: Schema.String },
  { httpApiStatus: 409 },
) {}

const id = { id: Schema.String }

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
  .middleware(Authorization)
