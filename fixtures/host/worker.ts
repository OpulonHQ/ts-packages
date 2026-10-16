import {
  type AssetsBinding,
  createWorker,
  PgFromHyperdrive,
  serveAdmin,
  type WorkerContext,
} from '@opulonjs/core/workers'
import { workersCachePurge } from '@opulonjs/core/workers'
import { Mailer } from '@opulonjs/emails/server'
import {
  type R2BucketLike,
  R2MediaStorage,
  r2MediaStorage,
  serveMedia,
} from '@opulonjs/media/server'
import { Layer } from 'effect'
import { server } from './server/opulon.ts'

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  readonly ASSETS: AssetsBinding
  /** R2 bucket holding media originals. */
  readonly MEDIA_BUCKET: R2BucketLike
  /** Commit SHA, set once in CI and passed to the admin build too (OPULON_BUILD_ID). */
  readonly OPULON_BUILD_ID: string
  /** The host's public origin (users: cookies, CSRF checks, emailed links). */
  readonly USERS_BASE_URL: string
  /** Signs session cookies (a secret: `wrangler secret put`). */
  readonly USERS_AUTH_SECRET: string
}

const withCacheControl = (response: Response, value: string) => {
  const copy = new Response(response.body, response)
  copy.headers.set('cache-control', value)
  return copy
}

const serveSite = async (request: Request, assets: AssetsBinding) => {
  const url = new URL(request.url)
  if (url.pathname !== '/site' && !url.pathname.startsWith('/site/')) return undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
  if (url.pathname.startsWith('/site/assets/')) {
    const file = await assets.fetch(request)
    if (file.ok) return withCacheControl(file, 'public, max-age=31536000, immutable')
    return file.status === 404 ? withCacheControl(file, 'no-store') : file
  }
  const index = await assets.fetch(new Request(new URL('/site/index.html', url), request))
  return withCacheControl(index, 'no-store')
}

/** The fixture Worker with a given Mailer; tests pass `captureMailer().layer`. */
export const hostWorker = (mailer: Layer.Layer<Mailer> = Mailer.log) => {
  const opulon = createWorker(server, {
    infra: (env: Env, ctx) =>
      Layer.mergeAll(
        PgFromHyperdrive(env.HYPERDRIVE),
        R2MediaStorage(env.MEDIA_BUCKET),
        mailer,
        // Purges Read API (and in-process SSR) Cache-Tags on publish from this Worker's own
        // Workers Cache (`cache.enabled` in wrangler.jsonc).
        workersCachePurge(ctx),
      ),
    buildId: (env) => env.OPULON_BUILD_ID,
  })
  return {
    ...opulon,
    async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
      return (
        (await serveSite(request, env.ASSETS)) ??
        (await serveAdmin(request, env.ASSETS)) ??
        (await serveMedia(request, r2MediaStorage(env.MEDIA_BUCKET))) ??
        opulon.fetch(request, env, ctx)
      )
    },
  }
}

// The fixture logs emails instead of sending them; a real host uses Mailer.resend().
export default hostWorker()
