import { Context, Effect, Layer, Option, Schema } from 'effect'

/** What storage knows about a stored original. */
export interface StoredObject {
  readonly size: number
  readonly contentType: string
  /** Quoted, ready for an `ETag` header. */
  readonly etag: string
}

export class MediaStorageError extends Schema.TaggedError<MediaStorageError>()(
  'MediaStorageError',
  { operation: Schema.Literals(['put', 'get', 'head']), key: Schema.String, cause: Schema.Unknown },
) {}

/**
 * Where originals live, by key `<id>/<version>/<filename>`. Objects are written once and never
 * deleted (a replace writes a new version's key). v1 ships only the R2 layer (TSPACK-13).
 */
export class MediaStorage extends Context.Service<
  MediaStorage,
  {
    readonly put: (
      key: string,
      bytes: Uint8Array,
      contentType: string,
    ) => Effect.Effect<void, MediaStorageError>
    readonly get: (
      key: string,
    ) => Effect.Effect<
      Option.Option<StoredObject & { readonly body: ReadableStream<Uint8Array> }>,
      MediaStorageError
    >
    readonly head: (key: string) => Effect.Effect<Option.Option<StoredObject>, MediaStorageError>
  }
>()('@opulonjs/media/MediaStorage') {}

interface R2ObjectLike {
  readonly size: number
  readonly httpEtag: string
  readonly httpMetadata?: { readonly contentType?: string } | undefined
}

/** The part of a Workers R2 bucket binding media uses; a real `R2Bucket` satisfies it. */
export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>
  get(key: string): Promise<(R2ObjectLike & { readonly body: ReadableStream<Uint8Array> }) | null>
  head(key: string): Promise<R2ObjectLike | null>
}

const stored = (object: R2ObjectLike): StoredObject => ({
  size: object.size,
  contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  etag: object.httpEtag,
})

/** MediaStorage over an R2 bucket binding, as a plain service (for `serveMedia`). */
export const r2MediaStorage = (bucket: R2BucketLike): MediaStorage['Service'] => {
  const attempt = <A>(operation: 'put' | 'get' | 'head', key: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new MediaStorageError({ operation, key, cause }),
    })
  return {
    put: (key, bytes, contentType) =>
      Effect.asVoid(
        attempt('put', key, () => bucket.put(key, bytes, { httpMetadata: { contentType } })),
      ),
    get: (key) =>
      attempt('get', key, () => bucket.get(key)).pipe(
        Effect.map((object) =>
          object ? Option.some({ ...stored(object), body: object.body }) : Option.none(),
        ),
      ),
    head: (key) =>
      attempt('head', key, () => bucket.head(key)).pipe(
        Effect.map((object) => (object ? Option.some(stored(object)) : Option.none())),
      ),
  }
}

/** The MediaStorage layer for a host's `infra(env)`: `R2MediaStorage(env.MEDIA_BUCKET)`. */
export const R2MediaStorage = (bucket: R2BucketLike) =>
  Layer.succeed(MediaStorage, r2MediaStorage(bucket))
