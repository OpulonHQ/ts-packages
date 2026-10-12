import { Background, CurrentActor, defineModule, withTransaction } from '@opulonjs/core'
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { SqlClient } from 'effect/sql/SqlClient'
import { DemoGroup, demoPermissions, Note, Tick } from './api.ts'
import createNote from './migrations/0001_create_note.ts'
import createTick from './migrations/0002_create_tick.ts'

export class Notes extends Context.Service<
  Notes,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<typeof Note.Type>>
    readonly ticks: () => Effect.Effect<ReadonlyArray<typeof Tick.Type>>
  }
>()('demo/Notes') {
  static readonly layer = Layer.effect(
    Notes,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      return {
        list: Effect.fn('Notes.list')(function* () {
          const rows = yield* sql`select id, body from demo.note order by id`
          return yield* Schema.decodeUnknownEffect(Schema.Array(Note))(rows)
        }, Effect.orDie),
        ticks: Effect.fn('Notes.ticks')(function* () {
          const rows = yield* sql`select actor, confirmed from demo.tick order by id`
          return yield* Schema.decodeUnknownEffect(Schema.Array(Tick))(rows)
        }, Effect.orDie),
      }
    }),
  )
}

/** Records a tick in a transaction; afterCommit work confirms it once the tick committed. */
const tick = Effect.gen(function* () {
  const sql = yield* SqlClient
  const actor = yield* CurrentActor
  yield* withTransaction(
    Effect.gen(function* () {
      const [row] = yield* sql<{ id: number }>`
        insert into demo.tick (actor) values (${actor.kind}) returning id`
      yield* Background.afterCommit(
        sql`update demo.tick set confirmed = true where id = ${row!.id}`,
      )
    }),
  )
})

/** A throwaway host module proving the module contract end to end. */
export const demo = defineModule({
  id: 'demo',
  groups: [DemoGroup],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'demo', (h) =>
      Effect.gen(function* () {
        const notes = yield* Notes
        return h.handle('notes', () => notes.list()).handle('ticks', () => notes.ticks())
      }),
    ),
  layer: Notes.layer,
  migrations: { '0001_create_note': createNote, '0002_create_tick': createTick },
  permissions: demoPermissions,
  tasks: [{ name: 'tick', every: '5m', run: tick }],
})
