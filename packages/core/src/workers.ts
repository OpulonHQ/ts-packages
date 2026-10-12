import * as PgClient from '@effect/sql-pg/PgClient'
import { Layer, Redacted } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import type { ComposedServer } from './compose.ts'

export { serveAdmin } from './admin-assets.ts'
export type { AssetsBinding } from './admin-assets.ts'

/** The part of the Workers ExecutionContext the adapter uses. */
export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

/** Turns leftover services into a readable type error at the createWorker call. */
type MissingServices<R> = [R] extends [never] ? unknown : { readonly missingServices: R }

/**
 * The Workers entry for a composed server. Every request builds its runtime from `infra(env)`
 * plus the composed layers and disposes it through `waitUntil` (Workers forbid sharing I/O
 * between requests). `infra` must provide every service the modules need and do not provide.
 */
export const createWorker = <R, Env, I, E>(
  server: ComposedServer<R>,
  options: {
    readonly infra: (env: Env) => Layer.Layer<I, E>
    /** The build id (commit SHA) the admin build carries too; `/me` reports it. */
    readonly buildId: (env: Env) => string
  } & MissingServices<Exclude<R, I>>,
) => ({
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    if (new URL(request.url).pathname === `${server.apiPrefix}/me`) {
      return me(server, options.buildId(env))
    }
    // Safe: MissingServices<Exclude<R, I>> proved at the call site that infra covers what the
    // composed layers still need; ComposedServer erases those types internally.
    const app = server.layer.pipe(
      Layer.provide(options.infra(env)),
      Layer.provide(HttpServer.layerServices),
    ) as Layer.Layer<never, unknown, HttpRouter.HttpRouter>
    const web = HttpRouter.toWebHandler(app, { disableLogger: true })
    try {
      return await web.handler(request)
    } finally {
      ctx.waitUntil(web.dispose())
    }
  },
})

/**
 * Minimal `/me` for the admin shell: build id and enabled module ids. TSPACK-25 turns it into the
 * staff-only endpoint with user, locale and permissions.
 */
const me = (server: ComposedServer<unknown>, buildId: string) =>
  Response.json(
    { buildId, modules: server.modules.map((m) => m.id) },
    { headers: { 'cache-control': 'private, no-store' } },
  )

/** SqlClient over a Hyperdrive binding: pool max 5, min 0, prepared statements on (TSPACK-18). */
export const PgFromHyperdrive = (binding: { readonly connectionString: string }) =>
  PgClient.layer({
    url: Redacted.make(binding.connectionString),
    maxConnections: 5,
    minConnections: 0,
  })
