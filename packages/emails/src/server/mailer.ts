import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'

/** A rendered email as a provider receives it. */
export interface OutgoingEmail {
  /** `Name <address>` or a bare address. */
  readonly from: string
  readonly to: ReadonlyArray<string>
  readonly replyTo?: string | undefined
  readonly subject: string
  readonly html: string
  readonly text: string
  /** Providers that support it send one email per key at most (the outbox passes the log id). */
  readonly idempotencyKey?: string | undefined
}

export class MailerError extends Schema.TaggedError<MailerError>()('MailerError', {
  message: Schema.String,
}) {}

/**
 * Sends one email through a provider. Layers: `Mailer.resend` (production), `Mailer.log`
 * (development) and `captureMailer()` (tests). The host picks one in its `infra(env)`.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    /** Resolves with the provider's message id (null when it has none). */
    readonly send: (
      email: OutgoingEmail,
    ) => Effect.Effect<{ readonly id: string | null }, MailerError>
  }
>()('@opulonjs/emails/Mailer') {
  /**
   * Resend over its REST API (plain fetch, Workers-safe). The API key is the
   * `EMAILS_RESEND_KEY` secret; without it every send fails (and stays queued for retries).
   */
  static readonly resend = (options: { readonly fetch?: typeof fetch } = {}) =>
    Layer.effect(
      Mailer,
      Effect.gen(function* () {
        const key = yield* Config.option(Config.Redacted('EMAILS_RESEND_KEY'))
        const doFetch = options.fetch ?? fetch
        return Mailer.of({
          send: Effect.fn('Mailer.send')(function* (email) {
            if (Option.isNone(key))
              return yield* new MailerError({ message: 'EMAILS_RESEND_KEY is not set' })
            // One deadline for the request and its body (a stalled body must not outlive it):
            // expiry aborts the signal, which cancels the body read. It sits well inside the
            // outbox's own delivery deadline.
            const { response, body } = yield* Effect.tryPromise({
              try: async (signal) => {
                const response = await doFetch('https://api.resend.com/emails', {
                  method: 'POST',
                  signal,
                  headers: {
                    authorization: `Bearer ${Redacted.value(key.value)}`,
                    'content-type': 'application/json',
                    ...(email.idempotencyKey ? { 'idempotency-key': email.idempotencyKey } : {}),
                  },
                  body: JSON.stringify({
                    from: email.from,
                    to: email.to,
                    subject: email.subject,
                    html: email.html,
                    text: email.text,
                    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
                  }),
                })
                const body = await new Response(
                  response.body?.pipeThrough(new TransformStream(), { signal }),
                )
                  .json()
                  .catch((): unknown => undefined)
                return { response, body }
              },
              catch: (cause) => new MailerError({ message: `Resend request failed: ${cause}` }),
            }).pipe(
              Effect.timeoutOrElse({
                duration: '30 seconds',
                orElse: () => Effect.fail(new MailerError({ message: 'Resend timed out' })),
              }),
            )
            const result = Schema.decodeUnknownOption(ResendResponse)(body)
            if (!response.ok)
              return yield* new MailerError({
                message: `Resend API error (${response.status}): ${Option.match(result, {
                  onNone: () => response.statusText,
                  onSome: (r) => r.message ?? response.statusText,
                })}`,
              })
            return { id: Option.match(result, { onNone: () => null, onSome: (r) => r.id ?? null }) }
          }),
        })
      }),
    )

  /** Development: logs recipients and subject instead of sending. */
  static readonly log = Layer.succeed(
    Mailer,
    Mailer.of({
      send: (email) =>
        Effect.logInfo('email not sent (log mailer)', {
          to: email.to,
          subject: email.subject,
        }).pipe(Effect.as({ id: null })),
    }),
  )
}

const ResendResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})

/**
 * Tests: a Mailer that records what it sends. Keep the returned object across requests (the
 * worker builds its layers per request); set `failure` to make sends fail with that message.
 */
export const captureMailer = () => {
  const state: { readonly sent: Array<OutgoingEmail>; failure: string | undefined } = {
    sent: [],
    failure: undefined,
  }
  const layer = Layer.succeed(
    Mailer,
    Mailer.of({
      send: (email) =>
        Effect.suspend(() => {
          if (state.failure !== undefined)
            return Effect.fail(new MailerError({ message: state.failure }))
          state.sent.push(email)
          return Effect.succeed({ id: `captured-${state.sent.length}` })
        }),
    }),
  )
  return Object.assign(state, { layer })
}
