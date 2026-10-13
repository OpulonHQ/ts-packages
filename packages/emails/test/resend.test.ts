import { ConfigProvider, Effect, Exit, Fiber, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, test } from 'vitest'
import { Mailer } from '../src/server/index.ts'

const email = {
  from: 'Shop <noreply@example.test>',
  to: ['jana@example.test'],
  replyTo: 'help@example.test',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  idempotencyKey: 'log-1',
}

// Resend is reached through an injected fetch; nothing leaves the machine.
const send = (env: Record<string, string>, reply: Response) => {
  const calls: Array<Request> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init))
    return reply
  }
  const layer = Mailer.resend({ fetch }).pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
  )
  const exit = Effect.runPromiseExit(
    Effect.flatMap(Mailer, (m) => m.send(email)).pipe(Effect.provide(layer)),
  )
  return { exit, calls }
}

test('posts the email to Resend with the key and the idempotency key', async () => {
  const { exit, calls } = send(
    { EMAILS_RESEND_KEY: 're_123' },
    Response.json({ id: 'msg-1' }, { status: 200 }),
  )
  expect(await exit).toEqual(Exit.succeed({ id: 'msg-1' }))
  const [request] = calls
  expect(request?.url).toBe('https://api.resend.com/emails')
  expect(request?.headers.get('authorization')).toBe('Bearer re_123')
  expect(request?.headers.get('idempotency-key')).toBe('log-1')
  expect(await request?.json()).toEqual({
    from: email.from,
    to: email.to,
    subject: 'Hi',
    html: '<p>Hi</p>',
    text: 'Hi',
    reply_to: 'help@example.test',
  })
})

test('fails with the provider message on an error response, never leaking the key', async () => {
  const { exit } = send(
    { EMAILS_RESEND_KEY: 're_123' },
    Response.json({ message: 'Invalid from address' }, { status: 422 }),
  )
  const result = await exit
  expect(JSON.stringify(result)).toContain('Resend API error (422): Invalid from address')
  expect(JSON.stringify(result)).not.toContain('re_123')
})

test('fails without calling Resend when the key is not set', async () => {
  const { exit, calls } = send({}, Response.json({ id: 'x' }))
  expect(JSON.stringify(await exit)).toContain('EMAILS_RESEND_KEY is not set')
  expect(calls).toHaveLength(0)
})

test('one deadline covers the answer body too: a stalled body is cancelled and the send fails', async () => {
  const called = Promise.withResolvers<void>()
  let cancelled = false
  const fetch: typeof globalThis.fetch = async () => {
    called.resolve()
    return new Response(new ReadableStream({ cancel: () => void (cancelled = true) }))
  }
  const layer = Mailer.resend({ fetch }).pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ EMAILS_RESEND_KEY: 'k' }))),
  )
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const mailer = yield* Mailer
      const fiber = yield* Effect.forkChild(mailer.send(email))
      yield* Effect.promise(() => called.promise)
      yield* TestClock.adjust('31 seconds')
      return yield* Fiber.join(fiber)
    }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
  )
  expect(JSON.stringify(exit)).toContain('Resend timed out')
  expect(cancelled).toBe(true)
})
