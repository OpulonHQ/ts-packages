import { authorization } from '@opulonjs/core'
import {
  type AssetsBinding,
  createWorker,
  PgFromHyperdrive,
  serveAdmin,
  type WorkerContext,
} from '@opulonjs/core/workers'
import { Effect, Layer } from 'effect'
import { server } from './server/opulon.ts'

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  /** Static assets (fixtures/host/public); the admin build lands in public/admin. */
  readonly ASSETS: AssetsBinding
  /** Commit SHA, set once in CI and passed to the admin build too (OPULON_BUILD_ID). */
  readonly OPULON_BUILD_ID: string
  /** Bearer token of the stub user; users replaces this with real sessions. */
  readonly DEMO_TOKEN: string
}

// Stub until users ships: one bearer token grants the demo permission.
const stubAuthorization = (token: string) =>
  authorization((request) =>
    Effect.succeed(
      token && request.headers.authorization === `Bearer ${token}`
        ? { id: 'demo-user', permissions: ['demo.notes.view'] }
        : undefined,
    ),
  )

const opulon = createWorker(server, {
  infra: (env: Env) =>
    Layer.mergeAll(PgFromHyperdrive(env.HYPERDRIVE), stubAuthorization(env.DEMO_TOKEN)),
  buildId: (env) => env.OPULON_BUILD_ID,
})

export default {
  ...opulon,
  // The admin SPA first (only /admin/**), then the composed API.
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    return (await serveAdmin(request, env.ASSETS)) ?? opulon.fetch(request, env, ctx)
  },
}
