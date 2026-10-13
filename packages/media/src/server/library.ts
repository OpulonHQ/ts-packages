import {
  Audit,
  Background,
  CachePurge,
  CachePurger,
  ContentLocales,
  CurrentActor,
  diffFields,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import {
  LocalizedText,
  mediaCacheTag,
  mediaCacheTags,
  type MediaItem,
  MediaNotFound,
  MediaRejected,
  mediaMimeTypes,
  type ResolvedMedia,
} from '../api.ts'
import { ImageUrl, srcset } from './image-url.ts'
import { dimensions, isAllowedMime, safeFilename, sniff } from './sniff.ts'
import { MediaStorage } from './storage.ts'

/** A file as uploaded: the browser's name and declared type, and its bytes. */
export interface UploadedFile {
  readonly name: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

export type { ResolvedMedia }

export interface ListQuery {
  readonly search?: string
  readonly type?: 'image' | 'pdf'
  readonly status?: 'active' | 'archived'
  readonly page?: number
  readonly perPage?: number
}

const Row = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  filename: Schema.String,
  mime: Schema.Literals(mediaMimeTypes),
  size: Schema.Number,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  alt: LocalizedText,
  caption: LocalizedText,
  archived_at: Schema.NullOr(Schema.Date),
  created_at: Schema.Date,
  updated_at: Schema.Date,
})
type Row = typeof Row.Type
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row))

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const columns =
  'id, version, filename, mime, size, width, height, alt, caption, archived_at, created_at, updated_at'

export const mediaUrl = (row: Pick<Row, 'id' | 'version' | 'filename'>) =>
  `/media/${row.id}/${row.version}/${row.filename}`
const storageKey = (row: Pick<Row, 'id' | 'version' | 'filename'>) =>
  `${row.id}/${row.version}/${row.filename}`

const toItem = (row: Row): MediaItem => ({
  id: row.id,
  version: row.version,
  filename: row.filename,
  mime: row.mime,
  size: row.size,
  width: row.width,
  height: row.height,
  alt: row.alt,
  caption: row.caption,
  url: mediaUrl(row),
  archivedAt: row.archived_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

const formatBytes = (bytes: number) =>
  bytes >= 1048576
    ? `${Math.round((bytes / 1048576) * 10) / 10} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} bytes`

export const tooLarge = (maxBytes: number) =>
  new MediaRejected({
    reason: 'too_large',
    message: `The file is larger than the ${formatBytes(maxBytes)} limit.`,
  })

/**
 * Checks an upload against the allowlist and the size limit by its bytes (never by its name),
 * and reads image dimensions.
 */
export const inspect = (file: UploadedFile, maxBytes: number) =>
  Effect.gen(function* () {
    const reject = (reason: MediaRejected['reason'], message: string) =>
      Effect.fail(new MediaRejected({ reason, message }))
    if (file.bytes.length === 0) return yield* reject('missing_file', 'The file is empty.')
    if (file.bytes.length > maxBytes) return yield* tooLarge(maxBytes)
    const declared = file.contentType.toLowerCase().split(';')[0]!.trim()
    const mime = sniff(file.bytes)
    if (declared === 'image/svg+xml' || declared.startsWith('video/') || !mime)
      return yield* reject(
        isAllowedMime(declared) ? 'type_mismatch' : 'unsupported_type',
        isAllowedMime(declared)
          ? `The file's content is not a valid ${declared} file.`
          : 'Only JPEG, PNG, WebP, AVIF and GIF images and PDF files can be uploaded.',
      )
    if (isAllowedMime(declared) && declared !== mime)
      return yield* reject(
        'type_mismatch',
        `The file is declared as ${declared}, but its content is ${mime}.`,
      )
    if (mime === 'application/pdf') return { mime, width: null, height: null }
    const size = dimensions(file.bytes)
    if (!size)
      return yield* reject('type_mismatch', `The file's content is not a valid ${mime} file.`)
    return { mime, ...size }
  })

/** Keeps text for content locales only, trimmed; empty values are dropped. */
const localized = (text: LocalizedText, locales: ReadonlyArray<string>): LocalizedText =>
  Object.fromEntries(
    Object.entries(text)
      .map(([locale, value]) => [locale, value.trim().slice(0, 2000)] as const)
      .filter(([locale, value]) => locales.includes(locale) && value !== ''),
  )

/** The media library. Every method except `resolve` checks the actor's permission itself. */
export class MediaLibrary extends Context.Service<
  MediaLibrary,
  {
    readonly list: (
      query: ListQuery,
    ) => Effect.Effect<{ rows: ReadonlyArray<MediaItem>; total: number }, MediaForbidden>
    readonly get: (id: string) => Effect.Effect<MediaItem, MediaNotFound | MediaForbidden>
    readonly upload: (
      file: UploadedFile,
    ) => Effect.Effect<MediaItem, MediaRejected | MediaForbidden>
    readonly replace: (
      id: string,
      file: UploadedFile,
    ) => Effect.Effect<MediaItem, MediaRejected | MediaNotFound | MediaForbidden>
    readonly update: (
      id: string,
      text: { readonly alt?: LocalizedText; readonly caption?: LocalizedText },
    ) => Effect.Effect<MediaItem, MediaNotFound | MediaForbidden>
    readonly archive: (id: string) => Effect.Effect<MediaItem, MediaNotFound | MediaForbidden>
    readonly restore: (id: string) => Effect.Effect<MediaItem, MediaNotFound | MediaForbidden>
    /**
     * Resolves media ids for rendering in `locale` (no permission check: public data). Unknown
     * ids are absent from the map; archived items still resolve, as their URLs keep serving.
     */
    readonly resolve: (
      ids: ReadonlyArray<string>,
      locale: string,
    ) => Effect.Effect<ReadonlyMap<string, ResolvedMedia>>
  }
>()('@opulonjs/media/MediaLibrary') {
  static readonly layer = (options: {
    readonly maxBytes: number
    readonly widths: ReadonlyArray<number>
  }) =>
    Layer.effect(
      MediaLibrary,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const background = yield* Background
        const purger = yield* CachePurger
        const purge = (id: string) =>
          CachePurge.afterCommit([mediaCacheTag(id), mediaCacheTags.all]).pipe(
            Effect.provideService(Background, background),
            Effect.provideService(CachePurger, purger),
          )
        const storage = yield* MediaStorage
        const imageUrl = yield* ImageUrl

        const find = (id: string, lock = false) =>
          Effect.gen(function* () {
            if (!uuid.test(id)) return yield* new MediaNotFound({ id })
            const rows = yield* decodeRows(
              yield* sql`select ${sql.literal(columns)} from media.item where id = ${id}
                ${sql.literal(lock ? 'for update' : '')}`,
            )
            const row = rows[0]
            return row ?? (yield* new MediaNotFound({ id }))
          })

        const subject = (row: Row) => ({ type: 'media', id: row.id, label: row.filename })

        const setArchived = (id: string, archived: boolean) =>
          Effect.gen(function* () {
            yield* requirePermission('media.archive')
            return yield* withTransaction(
              Effect.gen(function* () {
                const row = yield* find(id, true)
                if ((row.archived_at !== null) === archived) return toItem(row)
                const [updated] = yield* decodeRows(
                  yield* sql`update media.item
                    set archived_at = ${archived ? sql.literal('now()') : null}, updated_at = now()
                    where id = ${id} returning ${sql.literal(columns)}`,
                )
                yield* Audit.record({
                  action: archived ? 'media.item.archived' : 'media.item.restored',
                  subject: subject(updated!),
                })
                yield* purge(id)
                return toItem(updated!)
              }),
            )
          })

        return {
          list: Effect.fn('MediaLibrary.list')(
            function* (query: ListQuery) {
              yield* requirePermission('media.view')
              const perPage = Math.min(Math.max(Math.trunc(query.perPage ?? 25), 1), 100)
              const page = Math.max(Math.trunc(query.page ?? 1), 1)
              const search = query.search?.trim()
              const where = sql.and([
                query.status === 'archived'
                  ? sql`archived_at is not null`
                  : sql`archived_at is null`,
                ...(query.type === 'pdf' ? [sql`mime = 'application/pdf'`] : []),
                ...(query.type === 'image' ? [sql`mime <> 'application/pdf'`] : []),
                ...(search
                  ? [sql`(filename ilike ${`%${search}%`} or alt::text ilike ${`%${search}%`})`]
                  : []),
              ])
              const rows = yield* sql<{ total: string }>`
              select ${sql.literal(columns)}, count(*) over () as total from media.item
              where ${where} order by created_at desc, id
              limit ${perPage} offset ${(page - 1) * perPage}`
              const items = yield* decodeRows(rows)
              return { rows: items.map(toItem), total: Number(rows[0]?.total ?? 0) }
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            Effect.provideService(SqlClient, sql),
          ),

          get: Effect.fn('MediaLibrary.get')(
            function* (id: string) {
              yield* requirePermission('media.view')
              return toItem(yield* find(id))
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            Effect.provideService(SqlClient, sql),
          ),

          upload: Effect.fn('MediaLibrary.upload')(
            function* (file: UploadedFile) {
              yield* requirePermission('media.upload')
              const checked = yield* inspect(file, options.maxBytes)
              const actor = yield* CurrentActor
              const row = {
                id: crypto.randomUUID(),
                version: 1,
                filename: safeFilename(file.name, checked.mime),
              }
              // Written before the row: a failed insert leaves an unreferenced object, never a
              // row without its file.
              yield* storage.put(storageKey(row), file.bytes, checked.mime)
              return yield* withTransaction(
                Effect.gen(function* () {
                  const [inserted] = yield* decodeRows(
                    yield* sql`insert into media.item
                    (id, filename, mime, size, width, height, uploaded_by)
                    values (${row.id}, ${row.filename}, ${checked.mime}, ${file.bytes.length},
                      ${checked.width}, ${checked.height}, ${actor.kind === 'user' ? actor.id : null})
                    returning ${sql.literal(columns)}`,
                  )
                  yield* Audit.record({
                    action: 'media.item.uploaded',
                    subject: subject(inserted!),
                  })
                  return toItem(inserted!)
                }),
              )
            },
            Effect.catchTags({
              SqlError: Effect.die,
              SchemaError: Effect.die,
              MediaStorageError: Effect.die,
            }),
            Effect.provideService(SqlClient, sql),
          ),

          replace: Effect.fn('MediaLibrary.replace')(
            function* (id: string, file: UploadedFile) {
              yield* requirePermission('media.upload')
              const checked = yield* inspect(file, options.maxBytes)
              return yield* withTransaction(
                Effect.gen(function* () {
                  // Locked, so concurrent replaces get distinct versions.
                  const before = yield* find(id, true)
                  const next = {
                    id,
                    version: before.version + 1,
                    filename: safeFilename(file.name, checked.mime),
                  }
                  // The previous version's object stays: its URL keeps serving (TSPACK-13).
                  yield* storage.put(storageKey(next), file.bytes, checked.mime)
                  const [after] = yield* decodeRows(
                    yield* sql`update media.item set version = ${next.version},
                    filename = ${next.filename}, mime = ${checked.mime}, size = ${file.bytes.length},
                    width = ${checked.width}, height = ${checked.height}, updated_at = now()
                    where id = ${id} returning ${sql.literal(columns)}`,
                  )
                  yield* Audit.record({
                    action: 'media.item.replaced',
                    subject: subject(after!),
                    changes: diffFields(before, after!, ['version', 'filename', 'mime', 'size']),
                  })
                  yield* purge(id)
                  return toItem(after!)
                }),
              )
            },
            Effect.catchTags({
              SqlError: Effect.die,
              SchemaError: Effect.die,
              MediaStorageError: Effect.die,
            }),
            Effect.provideService(SqlClient, sql),
          ),

          update: Effect.fn('MediaLibrary.update')(
            function* (
              id: string,
              text: { readonly alt?: LocalizedText; readonly caption?: LocalizedText },
            ) {
              yield* requirePermission('media.upload')
              const locales = yield* ContentLocales
              return yield* withTransaction(
                Effect.gen(function* () {
                  const before = yield* find(id, true)
                  const alt = text.alt ? localized(text.alt, locales) : before.alt
                  const caption = text.caption ? localized(text.caption, locales) : before.caption
                  const [after] = yield* decodeRows(
                    yield* sql`update media.item set alt = ${JSON.stringify(alt)}::jsonb,
                    caption = ${JSON.stringify(caption)}::jsonb, updated_at = now()
                    where id = ${id} returning ${sql.literal(columns)}`,
                  )
                  const changes = locales.flatMap((locale) => [
                    ...diffText(`alt.${locale}`, before.alt[locale], alt[locale]),
                    ...diffText(`caption.${locale}`, before.caption[locale], caption[locale]),
                  ])
                  if (changes.length > 0)
                    yield* Audit.record({
                      action: 'media.item.updated',
                      subject: subject(after!),
                      changes,
                    })
                  yield* purge(id)
                  return toItem(after!)
                }),
              )
            },
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            Effect.provideService(SqlClient, sql),
          ),

          archive: Effect.fn('MediaLibrary.archive')(
            (id: string) => setArchived(id, true),
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            Effect.provideService(SqlClient, sql),
          ),

          restore: Effect.fn('MediaLibrary.restore')(
            (id: string) => setArchived(id, false),
            Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
            Effect.provideService(SqlClient, sql),
          ),

          resolve: Effect.fn('MediaLibrary.resolve')(function* (
            ids: ReadonlyArray<string>,
            locale: string,
          ) {
            const valid = [...new Set(ids.filter((id) => uuid.test(id)))]
            if (valid.length === 0) return new Map<string, ResolvedMedia>()
            const fallback = (yield* ContentLocales)[0]!
            const rows = yield* decodeRows(
              yield* sql`select ${sql.literal(columns)} from media.item where id in ${sql.in(valid)}`,
            )
            return new Map(
              rows.map((row): [string, ResolvedMedia] => {
                const url = mediaUrl(row)
                return [
                  row.id,
                  {
                    id: row.id,
                    url,
                    alt: row.alt[locale] ?? row.alt[fallback] ?? '',
                    caption: row.caption[locale] ?? row.caption[fallback] ?? null,
                    width: row.width,
                    height: row.height,
                    mime: row.mime,
                    srcset:
                      row.mime === 'application/pdf'
                        ? ''
                        : srcset(imageUrl, url, row.width, options.widths),
                  },
                ]
              }),
            )
          }, Effect.orDie),
        }
      }),
    )
}

type MediaForbidden = Forbidden

const diffText = (field: string, from: string | undefined, to: string | undefined) =>
  from === to ? [] : [{ field, from: from ?? null, to: to ?? null }]
