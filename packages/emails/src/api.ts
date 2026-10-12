// Client-safe: the emails HttpApi group and key catalogs, imported by the admin build too.
import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const emailsPermissions = ['emails.log.view'] as const

/** queued: waiting for (another) delivery attempt; failed: out of attempts. */
export const emailStatuses = ['queued', 'sent', 'failed', 'skipped'] as const
export const EmailStatus = Schema.Literals(emailStatuses)
export type EmailStatus = typeof EmailStatus.Type

/** One email log row. No body and no placeholder values: they may carry personal data. */
export const EmailLogEntry = Schema.Struct({
  id: Schema.String,
  templateKey: Schema.String,
  locale: Schema.String,
  recipients: Schema.Array(Schema.String),
  /** The rendered subject. */
  subject: Schema.String,
  status: EmailStatus,
  attempts: Schema.Number,
  /** The last delivery error, if any. */
  error: Schema.NullOr(Schema.String),
  /** ISO timestamps. */
  createdAt: Schema.String,
  sentAt: Schema.NullOr(Schema.String),
  /** What the email is about, as the sender described it (e.g. a user id). */
  about: Schema.NullOr(Schema.Struct({ type: Schema.String, id: Schema.String })),
})
export type EmailLogEntry = typeof EmailLogEntry.Type

export const EmailLogPage = Schema.Struct({
  rows: Schema.Array(EmailLogEntry),
  total: Schema.Number,
})

export const EmailsGroup = HttpApiGroup.make('emails')
  .add(
    HttpApiEndpoint.get('log', '/log', {
      query: {
        page: Schema.optional(Schema.FiniteFromString),
        perPage: Schema.optional(Schema.FiniteFromString),
        status: Schema.optional(EmailStatus),
      },
      success: EmailLogPage,
    }).annotate(Policy, 'emails.log.view'),
  )
  .middleware(Authorization)
