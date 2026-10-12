// Type-level tests, checked by `pnpm typecheck` (not run by vitest): a composed server whose
// modules need a service that neither an upstream module nor the host infra provides must not
// compile (TSPACK-7 decision 6).
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { expectTypeOf } from 'vitest'
import { composeServer, defineModule, Public, type Unprovided } from '../src/index.ts'
import { createWorker } from '../src/workers.ts'

class Db extends Context.Service<Db, { readonly query: Effect.Effect<number> }>()('Db') {}
class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<number> }>()('Clock') {}
class Media extends Context.Service<Media, { readonly url: Effect.Effect<string> }>()('Media') {}

const group = <const Id extends string>(id: Id) =>
  HttpApiGroup.make(id)
    .add(HttpApiEndpoint.get('ping', '/ping', { success: Schema.String }))
    .annotate(Public, true)

// media: its layer needs Db and provides Media; its handler needs Clock.
const media = defineModule({
  id: 'media',
  groups: [group('media')],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'media', (h) =>
      Effect.gen(function* () {
        const clock = yield* Clock
        return h.handle('ping', () => Effect.map(clock.now, String))
      }),
    ),
  layer: Layer.effect(
    Media,
    Effect.map(Db, () => ({ url: Effect.succeed('/media/1') })),
  ),
})

// cms: its layer needs Media, which media provides when listed first.
const cms = defineModule({
  id: 'cms',
  dependsOn: ['media'],
  groups: [group('cms')],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'cms', (h) => h.handle('ping', () => Effect.succeed('ok'))),
  layer: Layer.effect(
    Context.Service<{ readonly page: string }>('Cms'),
    Effect.map(Media, () => ({ page: '/' })),
  ),
})

const dbLive = Layer.succeed(Db, { query: Effect.succeed(1) })
const clockLive = Layer.succeed(Clock, { now: Effect.succeed(0) })

// The unprovided services are exactly what no upstream module provides.
expectTypeOf<Unprovided<[typeof media, typeof cms]>>().toEqualTypeOf<Db | Clock>()
// Listed out of dependency order, cms's Media is no longer provided by an upstream module.
expectTypeOf<Unprovided<[typeof cms, typeof media]>>().toEqualTypeOf<Db | Clock | Media>()

const server = composeServer({ modules: [media, cms] })

// Infra providing everything left compiles.
createWorker(server, { infra: () => Layer.mergeAll(dbLive, clockLive), buildId: () => 'b' })

// @ts-expect-error Clock (needed by media's handler) is provided by nobody.
createWorker(server, { infra: () => dbLive, buildId: () => 'b' })

// @ts-expect-error Db (needed by media's layer) is provided by nobody.
createWorker(server, { infra: () => clockLive, buildId: () => 'b' })
