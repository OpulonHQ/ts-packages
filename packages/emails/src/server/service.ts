import { Background, type Contribution, requirePermission } from '@opulonjs/core'
import { Cause, Context, Effect, Exit, Layer, Schema } from 'effect'
import type { Forbidden } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import { type EmailLogEntry, type EmailStatus } from '../api.ts'
import { Mailer, type OutgoingEmail } from './mailer.ts'
import {
  type EmailBrand,
  type EmailLayout,
  type EmailTemplate,
  EmailTemplates,
  renderEmail,
  resolveLocale,
} from './template.ts'

export interface SendInput<P extends string> {
  /** One address or several; all receive the same email. */
  readonly to: string | ReadonlyArray<string>
  /**
   * Staff templates: the recipient's admin locale (null: the admin default). Public templates:
   * a content locale. A locale outside the audience's set, or without wording, falls back to
   * the audience's default locale.
   */
  readonly locale?: string | null | undefined
  /** A value for every placeholder the template declares. */
  readonly vars: Readonly<Record<P, string>>
  /** What the email is about, shown in the email log, e.g. `{ type: 'user', id }`. */
  readonly about?: { readonly type: string; readonly id: string } | undefined
}

export interface ResolvedEmailsOptions {
  readonly from: string
  readonly replyTo: string | undefined
  readonly brand: EmailBrand
  readonly layout: EmailLayout
  readonly adminLocales: ReadonlyArray<string>
  readonly contentLocales: ReadonlyArray<string>
}

/** Delivery attempts per email, the first (after commit) included. */
export const maxAttempts = 3
/** Minutes before the first retry; doubles after every failed attempt. */
const backoffMinutes = 5
// ponytail: fixed sweep batch; deliveries run one by one. Raise or parallelize if a host
// queues more than ~20 emails per 5 minutes while its provider is down.
const sweepBatch = 20

const StoredMessage = Schema.Struct({
  from: Schema.String,
  to: Schema.Array(Schema.String),
  replyTo: Schema.optional(Schema.String),
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
})

const LogRow = Schema.Struct({
  id: Schema.String,
  templateKey: Schema.String,
  locale: Schema.String,
  recipients: Schema.Array(Schema.String),
  subject: Schema.String,
  status: Schema.Literals(['queued', 'sent', 'failed', 'skipped']),
  attempts: Schema.Number,
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  sentAt: Schema.NullOr(Schema.Date),
  aboutType: Schema.NullOr(Schema.String),
  aboutId: Schema.NullOr(Schema.String),
})

const addressPattern = /^[^\s@<>]+@[^\s@<>]+$/

/**
 * Sends templated emails through the outbox (ADR 0002): `send` writes a queued email log row
 * in the caller's transaction and delivers it after commit; the sweep task retries the rest.
 */
export class EmailService extends Context.Service<
  EmailService,
  {
    /**
     * Queues `template` for `input.to` in the caller's transaction (if any) and delivers it
     * after commit; a rollback never sends. Resolves with the email log id.
     */
    readonly send: <P extends string>(
      template: Contribution<EmailTemplate<P>>,
      input: SendInput<P>,
    ) => Effect.Effect<{ readonly id: string }, SqlError>
    /** Retries due queued emails in a bounded batch (the `emails.outbox_sweep` task). */
    readonly sweep: () => Effect.Effect<void, SqlError>
    /** Deletes log rows older than `days` in bounded batches (the `emails.log_purge` task). */
    readonly purge: (days: number) => Effect.Effect<void, SqlError>
    /** A page of the email log, newest first. Needs `emails.log.view`. */
    readonly log: (query: {
      readonly page: number
      readonly perPage: number
      readonly status?: EmailStatus | undefined
    }) => Effect.Effect<
      { readonly rows: ReadonlyArray<EmailLogEntry>; readonly total: number },
      SqlError | Forbidden
    >
  }
>()('@opulonjs/emails/EmailService') {
  static readonly make = (options: ResolvedEmailsOptions) =>
    Layer.effect(
      EmailService,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const mailer = yield* Mailer
        const background = yield* Background
        const templates = new Map((yield* EmailTemplates.collect).map((t) => [t.key, t]))

        /** Claims a due queued row (one attempt), sends it and records the outcome. */
        const deliver = Effect.fn('EmailService.deliver')(function* (id: string) {
          const [claimed] = yield* sql<{ attempts: number; message: unknown }>`
            update emails.email_log
            set attempts = attempts + 1,
              next_attempt_at = now() + make_interval(mins => ${backoffMinutes} * power(2, attempts)::int)
            where id = ${id} and status = 'queued' and next_attempt_at <= now()
            returning attempts, message`
          if (!claimed) return
          const message = yield* Schema.decodeUnknownEffect(StoredMessage)(claimed.message).pipe(
            Effect.orDie,
          )
          const exit = yield* Effect.exit(mailer.send({ ...message, idempotencyKey: id }))
          if (Exit.isSuccess(exit)) {
            yield* sql`update emails.email_log set status = 'sent', sent_at = now(),
              provider_message_id = ${exit.value.id}, message = null, error = null
              where id = ${id}`
            return
          }
          const error = Cause.pretty(exit.cause).slice(0, 2000)
          yield* Effect.logWarning(`email ${id} delivery failed (attempt ${claimed.attempts})`)
          if (claimed.attempts >= maxAttempts)
            yield* sql`update emails.email_log set status = 'failed', error = ${error},
              message = null where id = ${id}`
          else yield* sql`update emails.email_log set error = ${error} where id = ${id}`
        })

        return EmailService.of({
          send: Effect.fn('EmailService.send')(function* <P extends string>(
            template: Contribution<EmailTemplate<P>>,
            input: SendInput<P>,
          ) {
            const registered = templates.get(template.key)
            if (!registered)
              return yield* Effect.die(
                new Error(`email template "${template.key}" is not contributed by any module`),
              )
            const to = typeof input.to === 'string' ? [input.to] : [...input.to]
            if (to.length === 0 || !to.every((a) => addressPattern.test(a)))
              return yield* Effect.die(new Error(`invalid email recipients: ${to.join(', ')}`))
            const locale = resolveLocale(
              registered,
              input.locale,
              registered.audience === 'staff' ? options.adminLocales : options.contentLocales,
            )
            const rendered = renderEmail({
              content: registered.defaults[locale]!,
              locale,
              vars: input.vars,
              brand: options.brand,
              layout: options.layout,
            })
            const message: OutgoingEmail = {
              from: options.from,
              to,
              replyTo: options.replyTo,
              ...rendered,
            }
            const [row] = yield* sql<{ id: string }>`
              insert into emails.email_log
                (template_key, locale, recipients, subject, message, about_type, about_id)
              values (${registered.key}, ${locale}, ${JSON.stringify(to)}::jsonb,
                ${rendered.subject}, ${JSON.stringify(message)}::jsonb,
                ${input.about?.type ?? null}, ${input.about?.id ?? null})
              returning id`
            const id = row!.id
            yield* Background.afterCommit(deliver(id)).pipe(
              Effect.provideService(Background, background),
            )
            return { id }
          }),

          sweep: Effect.fn('EmailService.sweep')(function* () {
            const due = yield* sql<{ id: string }>`
              select id from emails.email_log
              where status = 'queued' and next_attempt_at <= now()
              order by next_attempt_at limit ${sweepBatch}`
            for (const { id } of due) yield* deliver(id)
          }),

          purge: Effect.fn('EmailService.purge')(function* (days: number) {
            // ponytail: at most 100 batches of 1000 rows per daily run; the rest waits a day.
            for (let i = 0; i < 100; i++) {
              const deleted = yield* sql`
                delete from emails.email_log where id in (
                  select id from emails.email_log
                  where created_at < now() - make_interval(days => ${days})
                  limit 1000)
                returning id`
              if (deleted.length < 1000) return
            }
          }),

          log: Effect.fn('EmailService.log')(function* (query) {
            yield* requirePermission('emails.log.view')
            const status = query.status ?? null
            const perPage = Math.min(Math.max(Math.trunc(query.perPage), 1), 100)
            const offset = (Math.max(Math.trunc(query.page), 1) - 1) * perPage
            const [rows, [count]] = yield* Effect.all(
              [
                sql`select id::text, template_key as "templateKey", locale, recipients, subject,
                    status, attempts, error, created_at as "createdAt", sent_at as "sentAt",
                    about_type as "aboutType", about_id as "aboutId"
                  from emails.email_log
                  where (${status}::text is null or status = ${status})
                  order by created_at desc, id
                  limit ${perPage} offset ${offset}`,
                sql<{ total: number }>`select count(*)::int as total from emails.email_log
                  where (${status}::text is null or status = ${status})`,
              ],
              { concurrency: 2 },
            )
            const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(LogRow))(rows).pipe(
              Effect.orDie,
            )
            return {
              total: count?.total ?? 0,
              rows: decoded.map(({ aboutType, aboutId, createdAt, sentAt, ...r }) => ({
                ...r,
                createdAt: createdAt.toISOString(),
                sentAt: sentAt?.toISOString() ?? null,
                about: aboutType && aboutId ? { type: aboutType, id: aboutId } : null,
              })),
            }
          }),
        })
      }),
    )
}
