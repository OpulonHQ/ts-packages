import { Effect, Option } from 'effect'
import type { MediaStorage, StoredObject } from './storage.ts'

const route = /^\/media\/([0-9a-f-]{36})\/([1-9]\d{0,8})\/([A-Za-z0-9_.-]{1,100})$/

/**
 * Serves originals at `/media/<id>/<version>/<filename>` from MediaStorage. Returns undefined
 * outside `/media/`, so the host chains it like `serveAdmin`:
 *
 *   (await serveMedia(request, r2MediaStorage(env.MEDIA_BUCKET))) ?? opulon.fetch(...)
 *
 * A version's URL never changes content (a replace bumps the version), so responses are
 * `public, immutable`. Archived items keep serving: references inside content can't be checked.
 */
export const serveMedia = async (
  request: Request,
  storage: MediaStorage['Service'],
): Promise<Response | undefined> => {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/media/')) return undefined
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  const match = route.exec(path)
  const notFound = () =>
    new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  if (!match) return notFound()

  const key = `${match[1]}/${match[2]}/${match[3]}`
  const head = request.method === 'HEAD'
  const found = await Effect.runPromise<
    Option.Option<StoredObject & { body?: ReadableStream }>,
    unknown
  >(head ? storage.head(key) : storage.get(key))
  if (Option.isNone(found)) return notFound()
  const object = found.value
  return new Response(object.body ?? null, {
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.size),
      etag: object.etag,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="${match[3]}"`,
    },
  })
}
