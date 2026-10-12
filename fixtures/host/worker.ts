import { authorization } from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Layer } from 'effect'
import { server } from './server/opulon.ts'

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
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

export default createWorker(server, {
  infra: (env: Env) =>
    Layer.mergeAll(PgFromHyperdrive(env.HYPERDRIVE), stubAuthorization(env.DEMO_TOKEN)),
})
