// Client-safe: the emails HttpApi group and key catalogs, imported by the admin build too.
import { Authorization, Policy } from '@opulonjs/core/api'
import { Schema } from 'effect'
import { NotFound } from 'effect/http-api/HttpApiError'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

export const emailsPermissions = ['emails.log.view', 'emails.templates.manage'] as const

export const emailsAuditActions = [
  { key: 'emails.template.overridden', subject: 'email_template' },
  { key: 'emails.template.reset', subject: 'email_template' },
  { key: 'emails.template.enabled', subject: 'email_template' },
  { key: 'emails.template.disabled', subject: 'email_template' },
  { key: 'emails.template.test_sent', subject: 'email_template' },
] as const

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

/** One locale's wording: a plain-text subject and a restricted rich text body. */
export const EmailContent = Schema.Struct({ subject: Schema.String, body: Schema.String })
export type EmailContent = typeof EmailContent.Type

export const EmailTemplateInfo = Schema.Struct({
  key: Schema.String,
  audience: Schema.Literals(['staff', 'public']),
  /** Sample values are used by previews and test sends. */
  placeholders: Schema.Array(Schema.Struct({ name: Schema.String, sample: Schema.String })),
  /** False: sends are logged as `skipped` and never delivered. */
  enabled: Schema.Boolean,
  /** The audience's locales (staff: admin locales, public: content locales). */
  locales: Schema.Array(
    Schema.Struct({
      locale: Schema.String,
      /** The code default; null when the template ships no wording for this locale. */
      default: Schema.NullOr(EmailContent),
      override: Schema.NullOr(EmailContent),
    }),
  ),
})
export type EmailTemplateInfo = typeof EmailTemplateInfo.Type

export const emailComponentPropKinds = ['text', 'url'] as const
export const EmailComponentInfo = Schema.Struct({
  name: Schema.String,
  props: Schema.Array(
    Schema.Struct({ name: Schema.String, kind: Schema.Literals(emailComponentPropKinds) }),
  ),
})
export type EmailComponentInfo = typeof EmailComponentInfo.Type

export const EmailTemplateList = Schema.Struct({
  templates: Schema.Array(EmailTemplateInfo),
  /** Components insertable into a body as `[[name prop="value"]]`. */
  components: Schema.Array(EmailComponentInfo),
})

export const RenderedPreview = Schema.Struct({
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
})

/** The wording breaks the template's rules (undeclared placeholder, unknown component, …). */
export class TemplateInvalid extends Schema.TaggedError<TemplateInvalid>()(
  'TemplateInvalid',
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

const templateParams = { key: Schema.String }
const localeParams = { key: Schema.String, locale: Schema.String }
const manage = 'emails.templates.manage'

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
  .add(
    HttpApiEndpoint.get('templates', '/templates', { success: EmailTemplateList }).annotate(
      Policy,
      manage,
    ),
  )
  .add(
    HttpApiEndpoint.put('saveOverride', '/templates/:key/locales/:locale', {
      params: localeParams,
      payload: EmailContent,
      success: EmailContent,
      error: [TemplateInvalid, NotFound],
    }).annotate(Policy, manage),
  )
  .add(
    HttpApiEndpoint.delete('resetOverride', '/templates/:key/locales/:locale', {
      params: localeParams,
      error: [TemplateInvalid, NotFound],
    }).annotate(Policy, manage),
  )
  .add(
    HttpApiEndpoint.put('setEnabled', '/templates/:key/enabled', {
      params: templateParams,
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      error: [TemplateInvalid, NotFound],
    }).annotate(Policy, manage),
  )
  .add(
    HttpApiEndpoint.post('preview', '/templates/:key/preview', {
      params: templateParams,
      payload: Schema.Struct({ locale: Schema.String, ...EmailContent.fields }),
      success: RenderedPreview,
      error: [TemplateInvalid, NotFound],
    }).annotate(Policy, manage),
  )
  .add(
    HttpApiEndpoint.post('testSend', '/templates/:key/test', {
      params: templateParams,
      payload: Schema.Struct({ locale: Schema.String }),
      success: Schema.Struct({ id: Schema.String }),
      error: [TemplateInvalid, NotFound],
    }).annotate(Policy, manage),
  )
  .middleware(Authorization)
