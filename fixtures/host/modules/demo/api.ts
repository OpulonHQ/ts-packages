import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const demoPermissions = ['demo.notes.view'] as const

export const Note = Schema.Struct({ id: Schema.Number, body: Schema.String })

/** One run of the demo task; its afterCommit work sets `confirmed`. */
export const Tick = Schema.Struct({ actor: Schema.String, confirmed: Schema.Boolean })

export const DemoGroup = HttpApiGroup.make('demo')
  .add(
    HttpApiEndpoint.get('notes', '/notes', { success: Schema.Array(Note) }).annotate(
      Policy,
      'demo.notes.view',
    ),
  )
  .add(
    HttpApiEndpoint.get('ticks', '/ticks', { success: Schema.Array(Tick) }).annotate(
      Policy,
      'demo.notes.view',
    ),
  )
  .middleware(Authorization)
