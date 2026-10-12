import * as PgClient from '@effect/sql-pg/PgClient'
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import { Background } from './background.ts'
import type { ComposedServer } from './compose.ts'
import { runDueTasks } from './tasks.ts'

/** The part of the Workers ExecutionContext the adapter uses. */
export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
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
 * from the `*\/5` cron. Every invocation builds its runtime from `infra(env)` plus the composed
 * layers (Workers forbid sharing I/O between requests) and disposes it only after its Background
 * work settled. `infra` must provide every service the modules need and do not provide.
 */
export const createWorker = <R, Env, I, E>(
  server: ComposedServer<R>,
  options: { readonly infra: (env: Env) => Layer.Layer<I, E> } & MissingServices<
    Exclude<R, I | Background>
  >,
) => ({
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const background = makeBackground()
    // Safe: MissingServices<Exclude<R, I | Background>> proved at the call site that infra and
    // Background cover what the composed layers still need; ComposedServer erases those types.
    const app = server.layer.pipe(
      Layer.provide(Layer.mergeAll(options.infra(env), background.layer)),
      Layer.provide(HttpServer.layerServices),
    ) as Layer.Layer<never, unknown, HttpRouter.HttpRouter>
    const web = HttpRouter.toWebHandler(app, { disableLogger: true })
    try {
      return await web.handler(request)
    } finally {
      ctx.waitUntil(background.drain().finally(() => web.dispose()))
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const background = makeBackground()
    // Safe for the same reason as in fetch; tasks need what handlers may need, minus CurrentActor
    // (provided by runDueTasks).
    const runtime = ManagedRuntime.make(
      server.services.pipe(
        Layer.provideMerge(Layer.mergeAll(options.infra(env), background.layer)),
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
})

/** SqlClient over a Hyperdrive binding: pool max 5, min 0, prepared statements on (TSPACK-18). */
export const PgFromHyperdrive = (binding: { readonly connectionString: string }) =>
  PgClient.layer({
    url: Redacted.make(binding.connectionString),
    maxConnections: 5,
    minConnections: 0,
  })
