import { authorization } from '@opulonjs/core'
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
import { Effect, Layer } from 'effect'
import { server } from './server/opulon.ts'

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  /** Static assets (fixtures/host/public); the admin build lands in public/admin. */
  readonly ASSETS: AssetsBinding
  /** R2 bucket holding media originals. */
  readonly MEDIA_BUCKET: R2BucketLike
  /** Commit SHA, set once in CI and passed to the admin build too (OPULON_BUILD_ID). */
  readonly OPULON_BUILD_ID: string
  /** Bearer token of the stub user; users replaces this with real sessions. */
  readonly DEMO_TOKEN: string
}

const demoPermissions = [
  'demo.notes.view',
  'emails.log.view',
  'media.view',
  'media.upload',
  'media.archive',
  'cms.pages.view',
  'cms.pages.edit',
  'cms.pages.publish',
]

// Stub until users ships: one bearer token signs in a demo staff user. Tests may narrow the
// user's permissions with `Bearer <token>:<permission>,<permission>`.
const stubAuthorization = (token: string) =>
  authorization((request) => {
    const [given, only] = (request.headers.authorization ?? '').split(':')
    return Effect.succeed(
      token && given === `Bearer ${token}`
        ? {
            id: 'demo-user',
            name: 'Demo User',
            email: 'demo@example.test',
            locale: 'sk',
            permissions:
              only === undefined
                ? demoPermissions
                : demoPermissions.filter((p) => only.split(',').includes(p)),
          }
        : undefined,
    )
  })

const opulon = createWorker(server, {
  infra: (env: Env) =>
    Layer.mergeAll(
      PgFromHyperdrive(env.HYPERDRIVE),
      stubAuthorization(env.DEMO_TOKEN),
      R2MediaStorage(env.MEDIA_BUCKET),
      // The fixture logs emails instead of sending them; a real host uses Mailer.resend().
      Mailer.log,
    ),
  buildId: (env) => env.OPULON_BUILD_ID,
})

export default {
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
