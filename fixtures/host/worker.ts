import {
  type AssetsBinding,
  createWorker,
  PgFromHyperdrive,
  serveAdmin,
  type WorkerContext,
} from '@opulonjs/core/workers'
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
  /** Static assets (fixtures/host/public); the admin build lands in public/admin. */
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

/** The fixture Worker with a given Mailer; tests pass `captureMailer().layer`. */
export const hostWorker = (mailer: Layer.Layer<Mailer> = Mailer.log) => {
  const opulon = createWorker(server, {
    infra: (env: Env) =>
      Layer.mergeAll(PgFromHyperdrive(env.HYPERDRIVE), R2MediaStorage(env.MEDIA_BUCKET), mailer),
    buildId: (env) => env.OPULON_BUILD_ID,
  })
  return {
    ...opulon,
    // The admin SPA (only /admin/**), media originals (only /media/**), then the composed API.
    async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
      return (
        (await serveAdmin(request, env.ASSETS)) ??
        (await serveMedia(request, r2MediaStorage(env.MEDIA_BUCKET))) ??
        opulon.fetch(request, env, ctx)
      )
    },
  }
}

// The fixture logs emails instead of sending them; a real host uses Mailer.resend().
export default hostWorker()
