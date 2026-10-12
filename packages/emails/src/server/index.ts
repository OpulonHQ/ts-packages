import { defineModule } from '@opulonjs/core'
import { Effect } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import { EmailsGroup, emailsPermissions } from '../api.ts'
import createEmailLog from './migrations/0001_create_email_log.ts'
import { EmailService } from './service.ts'
import { defaultLayout, type EmailBrand, type EmailLayout } from './template.ts'

export { captureMailer, Mailer, MailerError } from './mailer.ts'
export type { OutgoingEmail } from './mailer.ts'
export { EmailService, maxAttempts } from './service.ts'
export type { SendInput } from './service.ts'
export { defaultLayout, emailTemplate, EmailTemplates, escapeHtml } from './template.ts'
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
  /** Locales of staff emails, default first. Default `['en', 'sk']` (the admin's). */
  readonly adminLocales?: ReadonlyArray<string>
  /** Locales of public emails, default first. Default `['en']`. */
  readonly contentLocales?: ReadonlyArray<string>
  /** Days an email log row is kept. Default 90. */
  readonly logRetentionDays?: number
}

/**
 * The emails module: templates contributed by modules (`emailTemplate`), `EmailService.send`
 * through the outbox, the sweep and purge tasks, and the email log API. The host provides a
 * `Mailer` layer in its infra.
 */
export const emails = (options: EmailsOptions) =>
  defineModule({
    id: 'emails',
    groups: [EmailsGroup],
    handlers: (api) =>
      HttpApiBuilder.group(api, 'emails', (h) =>
        Effect.gen(function* () {
          const service = yield* EmailService
          return h.handle('log', ({ query }) =>
            service
              .log({ page: query.page ?? 1, perPage: query.perPage ?? 25, status: query.status })
              .pipe(Effect.catchTag('SqlError', Effect.die)),
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
    }),
    migrations: { '0001_create_email_log': createEmailLog },
    permissions: emailsPermissions,
    tasks: [
      { name: 'outbox_sweep', every: '5m', run: Effect.flatMap(EmailService, (s) => s.sweep()) },
      {
        name: 'log_purge',
        every: '1d',
        run: Effect.flatMap(EmailService, (s) => s.purge(options.logRetentionDays ?? 90)),
      },
    ],
  })
