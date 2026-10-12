import { defineModule } from '@opulonjs/core'
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { SqlClient } from 'effect/sql/SqlClient'
import { DemoGroup, demoPermissions, Note } from './api.ts'
import createNote from './migrations/0001_create_note.ts'

export class Notes extends Context.Service<
  Notes,
  { readonly list: () => Effect.Effect<ReadonlyArray<typeof Note.Type>> }
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
      }
    }),
  )
}

/** A throwaway host module proving the module contract end to end. */
export const demo = defineModule({
  id: 'demo',
  groups: [DemoGroup],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'demo', (h) =>
      Effect.gen(function* () {
        const notes = yield* Notes
        return h.handle('notes', () => notes.list())
      }),
    ),
  layer: Notes.layer,
  migrations: { '0001_create_note': createNote },
  permissions: demoPermissions,
})
