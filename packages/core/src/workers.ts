import * as PgClient from '@effect/sql-pg/PgClient'
import { Cause, ConfigProvider, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as HttpServerError from 'effect/http/HttpServerError'
import { Background } from './background.ts'
import { BuildId, type ComposedServer } from './compose.ts'
import { runDueTasks } from './tasks.ts'

export { serveAdmin } from './admin-assets.ts'
export type { AssetsBinding } from './admin-assets.ts'

/**
 * A failure's names and codes (`_tag` or `name`, then `code`, e.g. a SQLSTATE), nested causes
 * included. Never messages or stacks: they can carry user data (a Postgres error quotes the
 * value it rejected; a schema error's stack names the input path).
 */
const describe = (error: unknown, depth = 0): Record<string, unknown> => {
  if (typeof error !== 'object' || error === null) return { error: typeof error }
  const e = error as { _tag?: unknown; name?: unknown; code?: unknown; cause?: unknown }
  return {
    error: String(e._tag ?? e.name ?? 'unknown'),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(e.cause !== undefined && depth < 3 ? { cause: describe(e.cause, depth + 1) } : {}),
  }
}

const redact = (cause: Cause.Cause<unknown>) =>
  cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason)
      ? [describe(reason.defect)]
      : Cause.isFailReason(reason)
        ? [describe(reason.error)]
        : [],
  )

/** The part of the Workers ExecutionContext the adapter and host infra use. */
export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
  /**
   * The Worker's own cache (Workers Cache, `"cache": { "enabled": true }` in the Wrangler
   * config): `purge` drops cached responses by Cache-Tag. Absent outside Workers.
   */
  readonly cache?: {
    purge(options: { tags: Array<string> }): Promise<{
      readonly success: boolean
      readonly errors: ReadonlyArray<{ readonly code: number; readonly message: string }>
    }>
  }
}

/** The part of the Workers ScheduledController the adapter uses. */
export interface ScheduledEvent {
  readonly scheduledTime: number
  readonly cron: string
}

/** Turns leftover services into a readable type error at the createWorker call. */
type MissingServices<R> = [R] extends [never] ? unknown : { readonly missingServices: R }

/**
 * A per-invocation Background: work is collected while the request or tick runs and drained
 * afterwards. Work queued by drained work (nested afterCommit) is drained too.
 */
const makeBackground = () => {
  const pending: Array<Effect.Effect<void>> = []
  return {
    layer: Layer.succeed(Background, {
      run: (work) => {
        pending.push(work)
      },
    }),
    async drain() {
      // Jobs catch and log their own failures, so this never rejects.
      for (let job = pending.shift(); job; job = pending.shift()) await Effect.runPromise(job)
    },
  }
}

/**
 * The Workers entry for a composed server: `fetch` serves the API, `scheduled` runs due tasks
 * from the `*\/5` cron. Every invocation builds its runtime from `infra(env, ctx)` plus the
 * composed layers (Workers forbid sharing I/O between requests) and disposes it only after its
 * Background work settled. `infra` must provide every service the modules need and do not provide.
 * An answer without its own Cache-Control is sent `private, no-store`: with Workers Cache on, an
 * answer without one would be cached by its URL alone and served to every visitor.
 */
export const createWorker = <R, Env extends object, I, E>(
  server: ComposedServer<R>,
  options: {
    /** `ctx` is the invocation's (absent for a cron tick run without one, as in tests). */
    readonly infra: (env: Env, ctx?: WorkerContext) => Layer.Layer<I, E>
    /** The build id (commit SHA) the admin build carries too; `/me` reports it. */
    readonly buildId: (env: Env) => string
  } & MissingServices<Exclude<R, I | Background>>,
) => {
  /**
   * Per invocation: the build id, and Effect Config read from the env's string values (vars and
   * secrets) only. Bindings are objects and reach modules solely through the host's infra(env, ctx).
   */
  const envLayer = (env: Env) =>
    Layer.mergeAll(
      Layer.succeed(BuildId, options.buildId(env)),
      ConfigProvider.layer(
        ConfigProvider.fromEnvRecord(
          Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')),
        ),
      ),
    )
  return {
    async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
      const background = makeBackground()
      // Safe: MissingServices<Exclude<R, I | Background>> proved at the call site that infra and
      // Background cover what the composed layers still need; ComposedServer erases those types.
      const app = server.layer.pipe(
        Layer.provide(Layer.mergeAll(options.infra(env, ctx), background.layer, envLayer(env))),
        Layer.provide(HttpServer.layerServices),
      ) as Layer.Layer<never, unknown, HttpRouter.HttpRouter>
      // No per-request log line (Workers logs requests), but a failure answered with a 5xx logs
      // its cause, redacted: the client only sees a generic error, so this is its only trace.
      const web = HttpRouter.toWebHandler(app, {
        disableLogger: true,
        middleware: (effect) =>
          Effect.tapCause(effect, (cause) =>
            HttpServerError.causeResponseStripped(cause)[0].status >= 500
              ? Effect.logError('request failed', redact(cause))
              : Effect.void,
          ),
      })
      try {
        const response = await web.handler(request)
        if (!response.headers.has('cache-control')) {
          response.headers.set('cache-control', 'private, no-store')
        }
        return response
      } finally {
        ctx.waitUntil(background.drain().finally(() => web.dispose()))
      }
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx?: WorkerContext): Promise<void> {
      const background = makeBackground()
      // Safe for the same reason as in fetch; tasks need what handlers may need.
      const runtime = ManagedRuntime.make(
        server.services.pipe(
          Layer.provideMerge(
            Layer.mergeAll(options.infra(env, ctx), background.layer, envLayer(env)),
          ),
        ) as unknown as Layer.Layer<never, unknown>,
      )
      try {
        await runtime.runPromise(
          runDueTasks(server.modules, event.scheduledTime) as Effect.Effect<void>,
        )
      } finally {
        await background.drain()
        await runtime.dispose()
      }
    },
  }
}

/**
 * SqlClient over a Hyperdrive binding: pool max 5, min 0, prepared statements on (TSPACK-18).
 * Create the Hyperdrive config with `--caching-disabled`: cached reads are never invalidated
 * on write, which would defeat the cms Read API's purge on publish (docs/adr/0006).
 */
export const PgFromHyperdrive = (binding: { readonly connectionString: string }) =>
  PgClient.layer({
    url: Redacted.make(binding.connectionString),
    maxConnections: 5,
    minConnections: 0,
  })
