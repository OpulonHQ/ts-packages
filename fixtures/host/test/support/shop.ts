// A host module sending emails, composed with core and emails into a test worker whose infra
// captures sent emails instead of delivering them. Shared by the emails tests.
import {
  authorization,
  Authorization,
  composeServer,
  core,
  CurrentUser,
  defineModule,
  Policy,
  withTransaction,
} from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { EmailLogPage } from '@opulonjs/emails/api'
import {
  captureMailer,
  emailComponent,
  emails,
  EmailService,
  emailTemplate,
  escapeHtml,
} from '@opulonjs/emails/server'
import { Effect, Layer, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'

/** Public: a visitor's order confirmation, in a content locale. */
export const orderConfirmed = emailTemplate({
  key: 'shop.order_confirmed',
  audience: 'public',
  placeholders: { name: 'Jana', order: 'A-1' },
  defaults: {
    en: { subject: 'Order {{order}} confirmed', body: '<p>Thank you, {{name}}.</p>' },
    it: { subject: 'Ordine {{order}} confermato', body: '<p>Grazie, {{name}}.</p>' },
  },
})

/** Staff: an alert to the signed-in user, in their admin locale. */
export const staffAlert = emailTemplate({
  key: 'shop.staff_alert',
  audience: 'staff',
  placeholders: { name: 'Jana' },
  defaults: {
    en: { subject: 'Hello {{name}}', body: '<p>New orders are waiting.</p>' },
    sk: { subject: 'Ahoj {{name}}', body: '<p>Čakajú nové objednávky.</p>' },
  },
})

const ShopGroup = HttpApiGroup.make('shop')
  .add(
    HttpApiEndpoint.post('order', '/orders', {
      payload: Schema.Struct({
        email: Schema.String,
        name: Schema.String,
        locale: Schema.NullOr(Schema.String),
        rollback: Schema.Boolean,
      }),
      success: Schema.Struct({ id: Schema.String }),
    }).annotate(Policy, 'signedIn'),
  )
  .add(HttpApiEndpoint.post('alert', '/alerts').annotate(Policy, 'signedIn'))
  .middleware(Authorization)

const shop = defineModule({
  id: 'shop',
  dependsOn: ['emails'],
  groups: [ShopGroup],
  contributes: [orderConfirmed, staffAlert],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'shop', (h) =>
      Effect.gen(function* () {
        const mail = yield* EmailService
        return h
          .handle('order', ({ payload }) =>
            withTransaction(
              Effect.gen(function* () {
                const sent = yield* mail.send(orderConfirmed, {
                  to: payload.email,
                  locale: payload.locale,
                  vars: { name: payload.name, order: 'A-7' },
                  about: { type: 'order', id: 'A-7' },
                })
                if (payload.rollback) return yield* Effect.fail('roll back')
                return sent
              }),
            ).pipe(Effect.orElseSucceed(() => ({ id: 'rolled-back' }))),
          )
          .handle('alert', () =>
            Effect.gen(function* () {
              const user = yield* CurrentUser
              yield* mail.send(staffAlert, {
                to: user.email,
                locale: user.locale,
                vars: { name: user.name },
              })
            }).pipe(Effect.orDie),
          )
      }),
    ),
})

/** A host email component: a coupon code box. */
export const coupon = emailComponent({
  name: 'coupon',
  props: { code: 'text' },
  render: ({ code }) => `<div class="coupon">${escapeHtml(code ?? '')}</div>`,
})

export const shopServer = composeServer({
  modules: [
    core(),
    emails({
      from: 'Shop <noreply@example.test>',
      brand: { name: 'Shop', footer: { en: 'Shop footer', sk: 'Pätička obchodu' } },
      contentLocales: ['en', 'it'],
      components: [coupon],
    }),
    shop,
  ],
})

export interface ShopEnv {
  readonly url: string
  /** The signed-in user's admin locale. */
  readonly locale: string | null
  /** The signed-in user's permissions; default: every emails permission. */
  readonly permissions?: ReadonlyArray<string>
}

export function makeShop(databaseUrl: () => string) {
  const mailer = captureMailer()
  const worker = createWorker(shopServer, {
    infra: (env: ShopEnv) =>
      Layer.mergeAll(
        PgFromHyperdrive({ connectionString: env.url }),
        mailer.layer,
        authorization(() =>
          Effect.succeed({
            id: 'u1',
            name: 'Eva',
            email: 'eva@example.test',
            locale: env.locale,
            permissions: env.permissions ?? ['emails.log.view', 'emails.templates.manage'],
          }),
        ),
      ),
    buildId: () => 'test',
  })

  /** One request; resolves once the response is back and every waitUntil promise settled. */
  async function request(
    method: string,
    path: string,
    body?: unknown,
    locale: string | null = null,
    permissions?: ReadonlyArray<string>,
  ) {
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(
      new Request(`https://host.test/api${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      }),
      { url: databaseUrl(), locale, ...(permissions ? { permissions } : {}) },
      { waitUntil: (p) => pending.push(p) },
    )
    const text = await response.text()
    await Promise.all(pending)
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }

  /** The raw worker fetch, for admin tests routing their fetch into it. */
  const fetch = (request: Request, waitUntil: (p: Promise<unknown>) => void) =>
    worker.fetch(request, { url: databaseUrl(), locale: 'sk' }, { waitUntil })

  return {
    mailer,
    request,
    fetch,
    order: (o: { email?: string; name?: string; locale?: string | null; rollback?: boolean }) =>
      request('POST', '/shop/orders', {
        email: o.email ?? 'visitor@example.test',
        name: o.name ?? 'Jana',
        locale: o.locale ?? null,
        rollback: o.rollback ?? false,
      }),
    log: async (query = '') =>
      Schema.decodeUnknownSync(EmailLogPage)((await request('GET', `/emails/log${query}`)).body),
    /** Runs the cron tick at `time` (a UTC 5-minute bucket start). */
    tick: (time: string) =>
      worker.scheduled(
        { scheduledTime: Date.parse(time), cron: '*/5 * * * *' },
        {
          url: databaseUrl(),
          locale: null,
        },
      ),
  }
}
