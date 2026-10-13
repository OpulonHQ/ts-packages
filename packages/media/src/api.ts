// Client-safe: the media HttpApi group, its catalogs and schemas (TSPACK-13). Imported by the
// admin build too, so no server-only imports here.
import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import * as HttpApiSchema from 'effect/http-api/HttpApiSchema'

export const mediaPermissions = [
  'media.view',
  /** Also covers editing alt text and captions and replacing files. */
  'media.upload',
  'media.archive',
] as const

export const mediaAuditActions = [
  { key: 'media.item.uploaded', subject: 'media' },
  { key: 'media.item.replaced', subject: 'media' },
  { key: 'media.item.updated', subject: 'media' },
  { key: 'media.item.archived', subject: 'media' },
  { key: 'media.item.restored', subject: 'media' },
] as const

/** The allowlist, checked by magic bytes. No SVG (stored XSS) and no video (TSPACK-13). */
export const mediaMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
] as const
export type MediaMime = (typeof mediaMimeTypes)[number]

/** Text per content locale, e.g. `{ en: 'A lake', it: 'Un lago' }`; missing locales are absent. */
export const LocalizedText = Schema.Record(Schema.String, Schema.String)
export type LocalizedText = typeof LocalizedText.Type

/** A media item resolved for rendering in one content locale (cms Read API, public site). */
export const ResolvedMedia = Schema.Struct({
  id: Schema.String,
  /** The original: `/media/<id>/<version>/<filename>`. */
  url: Schema.String,
  /** In the requested locale, else the default content locale, else empty. */
  alt: Schema.String,
  caption: Schema.NullOr(Schema.String),
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  mime: Schema.Literals(mediaMimeTypes),
  /** Resized candidates from the host's width list; empty for PDFs. */
  srcset: Schema.String,
})
export type ResolvedMedia = typeof ResolvedMedia.Type

export const MediaItem = Schema.Struct({
  /** Stable id (uuid); survives replacing the file. */
  id: Schema.String,
  /** Bumped by every replace; part of the URL, so a replace busts caches. */
  version: Schema.Number,
  filename: Schema.String,
  mime: Schema.Literals(mediaMimeTypes),
  /** Bytes. */
  size: Schema.Number,
  /** Pixels, for images; null for PDFs. */
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  alt: LocalizedText,
  caption: LocalizedText,
  /** The original, served by the host's `/media/<id>/<version>/<filename>` route. */
  url: Schema.String,
  /** ISO timestamp; archived items are hidden from the library and picker but keep serving. */
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type MediaItem = typeof MediaItem.Type

export const MediaPage = Schema.Struct({ rows: Schema.Array(MediaItem), total: Schema.Number })

/** Why an upload was refused; `message` is shown to the editor as is. */
export class MediaRejected extends Schema.TaggedError<MediaRejected>()(
  'MediaRejected',
  {
    reason: Schema.Literals(['missing_file', 'too_large', 'unsupported_type', 'type_mismatch']),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class MediaNotFound extends Schema.TaggedError<MediaNotFound>()(
  'MediaNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Multipart body: one file part named `file` (send a FormData). */
const Upload = Schema.Struct({}).pipe(HttpApiSchema.asMultipartStream())
const id = { id: Schema.String }

export const MediaGroup = HttpApiGroup.make('media')
  .add(
    HttpApiEndpoint.get('list', '/items', {
      query: {
        /** Matches filename and alt text, case-insensitive. */
        search: Schema.optionalKey(Schema.String),
        type: Schema.optionalKey(Schema.Literals(['image', 'pdf'])),
        /** `archived` lists archived items only; default `active`. */
        status: Schema.optionalKey(Schema.Literals(['active', 'archived'])),
        page: Schema.optionalKey(Schema.FiniteFromString),
        perPage: Schema.optionalKey(Schema.FiniteFromString),
      },
      success: MediaPage,
    }).annotate(Policy, 'media.view'),
  )
  .add(
    HttpApiEndpoint.get('get', '/items/:id', {
      params: id,
      success: MediaItem,
      error: MediaNotFound,
    }).annotate(Policy, 'media.view'),
  )
  .add(
    HttpApiEndpoint.post('upload', '/items', {
      payload: Upload,
      success: MediaItem,
      error: MediaRejected,
    }).annotate(Policy, 'media.upload'),
  )
  .add(
    HttpApiEndpoint.put('replace', '/items/:id/file', {
      params: id,
      payload: Upload,
      success: MediaItem,
      error: [MediaRejected, MediaNotFound],
    }).annotate(Policy, 'media.upload'),
  )
  .add(
    HttpApiEndpoint.patch('update', '/items/:id', {
      params: id,
      payload: Schema.Struct({
        alt: Schema.optionalKey(LocalizedText),
        caption: Schema.optionalKey(LocalizedText),
      }),
      success: MediaItem,
      error: MediaNotFound,
    }).annotate(Policy, 'media.upload'),
  )
  .add(
    HttpApiEndpoint.post('archive', '/items/:id/archive', {
      params: id,
      success: MediaItem,
      error: MediaNotFound,
    }).annotate(Policy, 'media.archive'),
  )
  .add(
    HttpApiEndpoint.post('restore', '/items/:id/restore', {
      params: id,
      success: MediaItem,
      error: MediaNotFound,
    }).annotate(Policy, 'media.archive'),
  )
  .middleware(Authorization)
