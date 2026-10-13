import { CurrentUser, defineModule } from '@opulonjs/core'
import { Effect } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { EmailsGroup, emailsAuditActions, emailsPermissions } from '../api.ts'
import { componentRegistry, type EmailComponent } from './components.ts'
import createEmailLog from './migrations/0001_create_email_log.ts'
import createTemplateOverride from './migrations/0002_create_template_override.ts'
import { EmailService } from './service.ts'
import { defaultLayout, type EmailBrand, type EmailLayout } from './template.ts'

export { defaultComponents, emailComponent, escapeHtml } from './components.ts'
export type { EmailComponent, EmailComponentPropKind } from './components.ts'
export { captureMailer, Mailer, MailerError } from './mailer.ts'
export type { OutgoingEmail } from './mailer.ts'
export { EmailService, maxAttempts } from './service.ts'
export type { SendInput } from './service.ts'
export { defaultLayout, emailTemplate, EmailTemplates, sanitizeBody } from './template.ts'
export type {
  EmailAudience,
  EmailBrand,
  EmailContent,
  EmailLayout,
  EmailTemplate,
  LayoutInput,
} from './template.ts'

export interface EmailsOptions {
  /** Sender, `Name <address>` or a bare address. */
  readonly from: string
  readonly replyTo?: string
  readonly brand: EmailBrand
  /** Replaces the package layout (header, card, footer) for every email. */
  readonly layout?: EmailLayout
  /**
   * The host's email components, added to the package's (button, callout, divider, table).
   * Insertable in overrides and code defaults as `[[name prop="value"]]`.
   */
  readonly components?: ReadonlyArray<EmailComponent>
  /** Locales of staff emails, default first. Default `['en', 'sk']` (the admin's). */
  readonly adminLocales?: ReadonlyArray<string>
  /** Locales of public emails, default first. Default `['en']`. */
  readonly contentLocales?: ReadonlyArray<string>
  /** Days an email log row is kept. Default 90. */
  readonly logRetentionDays?: number
}

/**
 * The emails module: templates contributed by modules (`emailTemplate`), per-locale overrides
 * edited in the admin, `EmailService.send` through the outbox, the sweep and purge tasks, and
 * the email log API. The host provides a `Mailer` layer in its infra.
 */
export const emails = (options: EmailsOptions) =>
  defineModule({
    id: 'emails',
    groups: [EmailsGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'emails', (h) =>
        Effect.gen(function* () {
          const service = yield* EmailService
          return h
            .handle('log', ({ query }) =>
              service
                .log({ page: query.page ?? 1, perPage: query.perPage ?? 25, status: query.status })
                .pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('templates', () =>
              service.templates().pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('saveOverride', ({ params, payload }) =>
              service
                .saveOverride(params.key, params.locale, payload)
                .pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('resetOverride', ({ params }) =>
              service
                .resetOverride(params.key, params.locale)
                .pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('setEnabled', ({ params, payload }) =>
              service
                .setEnabled(params.key, payload.enabled)
                .pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('preview', ({ params, payload: { locale, ...content } }) =>
              service
                .preview(params.key, locale, content)
                .pipe(Effect.catchTag('SqlError', Effect.die)),
            )
            .handle('testSend', ({ params, payload }) =>
              Effect.flatMap(CurrentUser, (user) =>
                service.testSend(params.key, payload.locale, user.email),
              ).pipe(Effect.catchTag('SqlError', Effect.die)),
            )
        }),
      ),
    layer: EmailService.make({
      from: options.from,
      replyTo: options.replyTo,
      brand: options.brand,
      layout: options.layout ?? defaultLayout,
      adminLocales: options.adminLocales ?? ['en', 'sk'],
      contentLocales: options.contentLocales ?? ['en'],
      components: componentRegistry(options.components),
    }),
    migrations: {
      '0001_create_email_log': createEmailLog,
      '0002_create_template_override': createTemplateOverride,
    },
    permissions: emailsPermissions,
    auditActions: emailsAuditActions,
    tasks: [
      { name: 'outbox_sweep', every: '5m', run: Effect.flatMap(EmailService, (s) => s.sweep()) },
      {
        name: 'log_purge',
        every: '1d',
        run: Effect.flatMap(EmailService, (s) => s.purge(options.logRetentionDays ?? 90)),
      },
    ],
  })
