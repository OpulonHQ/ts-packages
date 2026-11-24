import { Authorization, Policy } from '@opulonjs/core/api'
import { AttachmentsTooLarge } from '@opulonjs/emails/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const demoPermissions = ['demo.notes.view'] as const

export const Note = Schema.Struct({ id: Schema.Number, body: Schema.String })

/** One run of the demo task; its afterCommit work sets `confirmed`. */
export const Tick = Schema.Struct({ actor: Schema.String, confirmed: Schema.Boolean })

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  'TooManyRequests',
  { retryAfter: Schema.Number },
  { httpApiStatus: 429 },
) {}

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
  .add(
    HttpApiEndpoint.post('ping', '/pings', { error: TooManyRequests }).annotate(
      Policy,
      'demo.notes.view',
    ),
  )
  .add(
    HttpApiEndpoint.post('share', '/notes/share', {
      payload: Schema.Struct({
        to: Schema.String,
        cc: Schema.optional(Schema.Array(Schema.String)),
        bcc: Schema.optional(Schema.Array(Schema.String)),
        replyTo: Schema.optional(Schema.String),
        note: Schema.String,
        storedBytes: Schema.optional(Schema.Number),
        fetchedBytes: Schema.optional(Schema.Number),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: AttachmentsTooLarge,
    }).annotate(Policy, 'demo.notes.view'),
  )
  .middleware(Authorization)
