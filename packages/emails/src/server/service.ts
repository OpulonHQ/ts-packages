import {
  Audit,
  Background,
  ContentLocales,
  type Contribution,
  diffFields,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import { Cause, Context, Effect, Exit, Layer, Schema } from 'effect'
import { type Forbidden, NotFound } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import {
  type EmailComponentInfo,
  type EmailLogEntry,
  type EmailStatus,
  type EmailTemplateInfo,
  TemplateInvalid,
} from '../api.ts'
import type { EmailComponent } from './components.ts'
import { Mailer, type OutgoingEmail } from './mailer.ts'
import {
  contentError,
  type EmailBrand,
  type EmailContent,
  type EmailLayout,
  type EmailTemplate,
  EmailTemplates,
  type RenderedEmail,
  renderEmail,
  resolveLocale,
  sanitizeBody,
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
  readonly components: ReadonlyMap<string, EmailComponent>
}

const OverrideRow = Schema.Struct({
  templateKey: Schema.String,
  locale: Schema.String,
  subject: Schema.String,
  body: Schema.String,
})

const manage = 'emails.templates.manage'
type ManageError = SqlError | Forbidden | NotFound | TemplateInvalid
const auditSubject = (key: string) => ({ type: 'email_template', id: key, label: key })

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
    /** Every contributed template with its overrides, and the components. Needs `emails.templates.manage` (so do the rest). */
    readonly templates: () => Effect.Effect<
      {
        readonly templates: ReadonlyArray<EmailTemplateInfo>
        readonly components: ReadonlyArray<EmailComponentInfo>
      },
      SqlError | Forbidden
    >
    /** Stores the sanitized wording as `key`'s override in `locale`; audited. */
    readonly saveOverride: (
      key: string,
      locale: string,
      content: EmailContent,
    ) => Effect.Effect<EmailContent, ManageError>
    /** Deletes the override, so the default applies again; audited when there was one. */
    readonly resetOverride: (key: string, locale: string) => Effect.Effect<void, ManageError>
    /** A disabled template's sends are logged as `skipped` and never delivered; audited. */
    readonly setEnabled: (key: string, enabled: boolean) => Effect.Effect<void, ManageError>
    /** Renders unsaved wording with the template's sample values. */
    readonly preview: (
      key: string,
      locale: string,
      content: EmailContent,
    ) => Effect.Effect<RenderedEmail, ManageError>
    /**
     * Queues the template's current wording in `locale` with sample values to `to` through the
     * outbox, even when it is disabled; audited.
     */
    readonly testSend: (
      key: string,
      locale: string,
      to: string,
    ) => Effect.Effect<{ readonly id: string }, ManageError>
  }
>()('@opulonjs/emails/EmailService') {
  static readonly make = (options: ResolvedEmailsOptions) =>
    Layer.effect(
      EmailService,
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const mailer = yield* Mailer
        const background = yield* Background
        // Public emails use the host's content locales (ADR 0005), staff emails the admin's.
        const contentLocales = yield* ContentLocales
        const templates = new Map((yield* EmailTemplates.collect).map((t) => [t.key, t]))
        // ponytail: re-checked on every layer build (per request); a few dozen small strings, so
        // well under a millisecond. Cache per template object if hosts grow large catalogs.
        for (const t of templates.values())
          for (const [locale, content] of Object.entries(t.defaults)) {
            const error = contentError(
              t,
              { subject: content.subject, body: sanitizeBody(content.body) },
              options.components,
            )
            if (error)
              return yield* Effect.die(
                new Error(`email template "${t.key}" (${locale}) default: ${error}`),
              )
          }
        const localesOf = (t: EmailTemplate) =>
          t.audience === 'staff' ? options.adminLocales : contentLocales
        const render = (content: EmailContent, locale: string, vars: Record<string, string>) =>
          renderEmail({
            content,
            locale,
            vars,
            brand: options.brand,
            layout: options.layout,
            components: options.components,
          })
        const tx = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
          withTransaction(effect).pipe(Effect.provideService(SqlClient, sql))
        const audit = (
          action: string,
          key: string,
          extra: Partial<Parameters<typeof Audit.record>[0]>,
        ) =>
          Audit.record({ action, subject: auditSubject(key), ...extra }).pipe(
            Effect.provideService(SqlClient, sql),
          )

        /** The template behind an admin request, checked against the permission and locale. */
        const managed = Effect.fn('EmailService.managed')(function* (key: string, locale?: string) {
          yield* requirePermission(manage)
          const template = templates.get(key)
          if (!template) return yield* new NotFound()
          if (locale !== undefined && !localesOf(template).includes(locale))
            return yield* new TemplateInvalid({
              message: `"${locale}" is not one of the template's locales (${localesOf(template).join(', ')})`,
            })
          return template
        })

        /** Sanitizes and checks wording an editor sent. */
        const checked = (template: EmailTemplate, content: EmailContent) => {
          const clean = { subject: content.subject.trim(), body: sanitizeBody(content.body) }
          const error = contentError(template, clean, options.components)
          return error
            ? Effect.fail(new TemplateInvalid({ message: error }))
            : Effect.succeed(clean)
        }

        const overridesOf = (key: string, locales: ReadonlyArray<string>) =>
          Effect.flatMap(
            sql`select template_key as "templateKey", locale, subject, body
              from emails.template_override
              where template_key = ${key} and locale in ${sql.in(locales)}`,
            (rows) =>
              Schema.decodeUnknownEffect(Schema.Array(OverrideRow))(rows).pipe(Effect.orDie),
          )

        /** Writes an email log row; queued rows are delivered after commit. */
        const queue = Effect.fn('EmailService.queue')(function* (o: {
          readonly key: string
          readonly locale: string
          readonly to: ReadonlyArray<string>
          readonly rendered: RenderedEmail
          readonly about: SendInput<string>['about']
          readonly skipped: boolean
        }) {
          const message: OutgoingEmail = {
            from: options.from,
            to: o.to,
            replyTo: options.replyTo,
            ...o.rendered,
          }
          const [row] = yield* sql<{ id: string }>`
            insert into emails.email_log
              (template_key, locale, recipients, subject, status, message, about_type, about_id)
            values (${o.key}, ${o.locale}, ${JSON.stringify(o.to)}::jsonb,
              ${o.rendered.subject}, ${o.skipped ? 'skipped' : 'queued'},
              ${o.skipped ? null : JSON.stringify(message)}::jsonb,
              ${o.about?.type ?? null}, ${o.about?.id ?? null})
            returning id`
          const id = row!.id
          if (!o.skipped)
            yield* Background.afterCommit(deliver(id)).pipe(
              Effect.provideService(Background, background),
            )
          return { id }
        })

        /** Claims a due queued row (one attempt), sends it and records the outcome. */
        const deliver = Effect.fn('EmailService.deliver')(function* (id: string) {
          const [claimed] = yield* sql<{ attempts: number; message: unknown }>`
            update emails.email_log
            set attempts = attempts + 1,
              next_attempt_at = now() + make_interval(mins => ${backoffMinutes} * power(2, attempts)::int)
            where id = ${id} and status = 'queued' and next_attempt_at <= now()
              and attempts < ${maxAttempts}
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
            const locales = localesOf(registered)
            const fallback = resolveLocale(registered, input.locale, locales)
            // An override in the requested locale wins, even where the code ships no wording.
            const requested =
              input.locale && locales.includes(input.locale) ? input.locale : fallback
            const [overrides, [disabled]] = yield* Effect.all([
              overridesOf(registered.key, [requested, fallback]),
              sql`select 1 from emails.disabled_template where template_key = ${registered.key}`,
            ])
            const override =
              overrides.find((o) => o.locale === requested) ??
              overrides.find((o) => o.locale === fallback)
            const locale = override?.locale ?? fallback
            return yield* queue({
              key: registered.key,
              locale,
              to,
              rendered: render(override ?? registered.defaults[locale]!, locale, input.vars),
              about: input.about,
              skipped: disabled !== undefined,
            })
          }),

          sweep: Effect.fn('EmailService.sweep')(function* () {
            // A last attempt cut off before its outcome was recorded (the Worker was killed)
            // left its row queued; once its backoff passed it is failed, never sent again.
            yield* sql`update emails.email_log set status = 'failed', message = null,
                error = 'the last attempt was interrupted before its outcome was recorded'
              where status = 'queued' and attempts >= ${maxAttempts} and next_attempt_at <= now()`
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

          templates: Effect.fn('EmailService.templates')(function* () {
            yield* requirePermission(manage)
            const [rows, disabledRows] = yield* Effect.all([
              sql`select template_key as "templateKey", locale, subject, body
                from emails.template_override`,
              sql<{ templateKey: string }>`select template_key as "templateKey"
                from emails.disabled_template`,
            ])
            const overrides = yield* Schema.decodeUnknownEffect(Schema.Array(OverrideRow))(
              rows,
            ).pipe(Effect.orDie)
            const disabled = new Set(disabledRows.map((r) => r.templateKey))
            const content = (c: EmailContent | undefined) =>
              c ? { subject: c.subject, body: c.body } : null
            return {
              templates: [...templates.values()]
                .sort((a, b) => a.key.localeCompare(b.key))
                .map((t) => ({
                  key: t.key,
                  audience: t.audience,
                  placeholders: Object.entries<string>(t.placeholders).map(([name, sample]) => ({
                    name,
                    sample,
                  })),
                  enabled: !disabled.has(t.key),
                  locales: localesOf(t).map((locale) => ({
                    locale,
                    default: content(t.defaults[locale]),
                    override: content(
                      overrides.find((o) => o.templateKey === t.key && o.locale === locale),
                    ),
                  })),
                })),
              components: [...options.components.values()].map((c) => ({
                name: c.name,
                props: Object.entries(c.props).map(([name, kind]) => ({ name, kind })),
              })),
            }
          }),

          saveOverride: Effect.fn('EmailService.saveOverride')(function* (key, locale, content) {
            const template = yield* managed(key, locale)
            const next = yield* checked(template, content)
            return yield* tx(
              Effect.gen(function* () {
                const [previous] = yield* overridesOf(key, [locale])
                yield* sql`insert into emails.template_override (template_key, locale, subject, body)
                  values (${key}, ${locale}, ${next.subject}, ${next.body})
                  on conflict (template_key, locale) do update
                  set subject = excluded.subject, body = excluded.body, updated_at = now()`
                const before = previous ?? template.defaults[locale] ?? { subject: '', body: '' }
                yield* audit('emails.template.overridden', key, {
                  changes: diffFields(before, next, ['subject', 'body']),
                  context: { locale },
                })
                return next
              }),
            )
          }),

          resetOverride: Effect.fn('EmailService.resetOverride')(function* (key, locale) {
            yield* managed(key, locale)
            yield* tx(
              Effect.gen(function* () {
                const deleted = yield* sql`delete from emails.template_override
                  where template_key = ${key} and locale = ${locale} returning locale`
                if (deleted.length > 0)
                  yield* audit('emails.template.reset', key, { context: { locale } })
              }),
            )
          }),

          setEnabled: Effect.fn('EmailService.setEnabled')(function* (key, enabled) {
            yield* managed(key)
            yield* tx(
              Effect.gen(function* () {
                const changed = enabled
                  ? yield* sql`delete from emails.disabled_template
                      where template_key = ${key} returning template_key`
                  : yield* sql`insert into emails.disabled_template (template_key)
                      values (${key}) on conflict do nothing returning template_key`
                if (changed.length > 0)
                  yield* audit(
                    enabled ? 'emails.template.enabled' : 'emails.template.disabled',
                    key,
                    {},
                  )
              }),
            )
          }),

          preview: Effect.fn('EmailService.preview')(function* (key, locale, content) {
            const template = yield* managed(key, locale)
            const clean = yield* checked(template, content)
            return render(clean, locale, template.placeholders)
          }),

          testSend: Effect.fn('EmailService.testSend')(function* (key, locale, to) {
            const template = yield* managed(key, locale)
            const [override] = yield* overridesOf(key, [locale])
            const fallback = resolveLocale(template, locale, localesOf(template))
            const used = override ? locale : fallback
            const rendered = render(
              override ?? template.defaults[used]!,
              used,
              template.placeholders,
            )
            return yield* tx(
              Effect.gen(function* () {
                const sent = yield* queue({
                  key,
                  locale: used,
                  to: [to],
                  rendered,
                  about: { type: 'email_template', id: key },
                  skipped: false,
                })
                yield* audit('emails.template.test_sent', key, { context: { locale } })
                return sent
              }),
            )
          }),
        })
      }),
    )
}
