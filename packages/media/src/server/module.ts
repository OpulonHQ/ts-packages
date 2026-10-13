import { cachePurgeStatusAccess, defineModule } from '@opulonjs/core'
import { Effect, Layer, Option, Stream } from 'effect'
import * as Multipart from 'effect/http/Multipart'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { MediaGroup, mediaAuditActions, mediaPermissions, MediaRejected } from '../api.ts'
import { ImageUrl } from './image-url.ts'
import { MediaLibrary, tooLarge, type UploadedFile } from './library.ts'
import createItem from './migrations/0001_create_item.ts'

export interface MediaOptions {
  /** Largest accepted upload in bytes. Default 20 MB. */
  readonly maxBytes?: number
  /** Display widths for `srcset` (pixels). Default 320, 640, 960, 1280, 1920. */
  readonly widths?: ReadonlyArray<number>
  /** Resized URL builder; default Cloudflare Image Transformations (`/cdn-cgi/image`). */
  readonly imageUrl?: ImageUrl['Service']
}

const defaultMaxBytes = 20 * 1024 * 1024
const defaultWidths = [320, 640, 960, 1280, 1920]

/**
 * Reads the multipart part named `file`, failing as soon as it passes `maxBytes` (so an
 * oversized body is never buffered whole).
 */
const readUpload = (
  parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
  maxBytes: number,
): Effect.Effect<UploadedFile, MediaRejected> =>
  parts.pipe(
    Stream.filter((part): part is Multipart.File => Multipart.isFile(part) && part.key === 'file'),
    Stream.take(1),
    Stream.mapEffect((file) =>
      Effect.gen(function* () {
        const chunks: Array<Uint8Array> = []
        let size = 0
        yield* Stream.runForEach(file.content, (chunk) => {
          size += chunk.length
          chunks.push(chunk)
          return size > maxBytes ? Effect.fail(tooLarge(maxBytes)) : Effect.void
        })
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        const upload: UploadedFile = { name: file.name, contentType: file.contentType, bytes }
        return upload
      }),
    ),
    Stream.runHead,
    Effect.catchTag('MultipartError', () => Effect.succeed(Option.none<UploadedFile>())),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new MediaRejected({
              reason: 'missing_file',
              message: 'Send the file as a multipart form part named "file".',
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  )

/**
 * The media module (TSPACK-13): the library's HttpApi under `/api/media`, its schema and
 * permissions. Needs `MediaStorage` (e.g. `R2MediaStorage(env.MEDIA_BUCKET)`) and the SqlClient
 * from the host's infra; provides `MediaLibrary` (and `ImageUrl`) to later modules such as cms.
 */
export const media = (options: MediaOptions = {}) => {
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  return defineModule({
    id: 'media',
    dependsOn: ['core'],
    contributes: [cachePurgeStatusAccess('media.upload'), cachePurgeStatusAccess('media.archive')],
    groups: [MediaGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'media', (h) =>
        Effect.gen(function* () {
          const library = yield* MediaLibrary
          return h
            .handle('list', ({ query }) => library.list(query))
            .handle('get', ({ params }) => library.get(params.id))
            .handle('upload', ({ payload }) =>
              readUpload(payload, maxBytes).pipe(Effect.flatMap(library.upload)),
            )
            .handle('replace', ({ params, payload }) =>
              readUpload(payload, maxBytes).pipe(
                Effect.flatMap((file) => library.replace(params.id, file)),
              ),
            )
            .handle('update', ({ params, payload }) => library.update(params.id, payload))
            .handle('archive', ({ params }) => library.archive(params.id))
            .handle('restore', ({ params }) => library.restore(params.id))
        }),
      ),
    layer: Layer.provideMerge(
      MediaLibrary.layer({ maxBytes, widths: options.widths ?? defaultWidths }),
      ImageUrl.layer(options.imageUrl),
    ),
    migrations: { '0001_create_item': createItem },
    permissions: mediaPermissions,
    auditActions: mediaAuditActions,
  })
}
