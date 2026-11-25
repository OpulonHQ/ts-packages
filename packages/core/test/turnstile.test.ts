import { expect, test } from 'vitest'
import { type TurnstileCheck, verifyTurnstile } from '../src/turnstile.ts'

const passSecret = '1x0000000000000000000000000000000AA'

const answering =
  (body: unknown, seen?: Array<{ url: string; form: Record<string, string> }>): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init)
    seen?.push({
      url: request.url,
      form: Object.fromEntries(new URLSearchParams(await request.text())),
    })
    return Response.json(body)
  }

const real = (answer: object, check: Partial<TurnstileCheck> = {}) =>
  verifyTurnstile({
    secret: 'a-real-secret',
    hostnames: ['example.org', 'www.example.org'],
    action: 'contact',
    token: 'a-token',
    fetch: answering({ success: true, 'error-codes': [], ...answer }),
    ...check,
  })

test('a token siteverify accepts for the expected action and an allowed hostname passes', async () => {
  const seen: Array<{ url: string; form: Record<string, string> }> = []
  expect(
    await real(
      {},
      {
        remoteIp: '203.0.113.7',
        fetch: answering({ success: true, hostname: 'WWW.example.org', action: 'contact' }, seen),
      },
    ),
  ).toEqual({ ok: true })
  expect(seen).toEqual([
    {
      url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      form: { secret: 'a-real-secret', response: 'a-token', remoteip: '203.0.113.7' },
    },
  ])
})

test('another action, another hostname or a missing one refuses', async () => {
  expect(await real({ hostname: 'example.org', action: 'order' })).toEqual({
    ok: false,
    reason: 'wrong-action',
  })
  expect(await real({ hostname: 'example.org' })).toEqual({ ok: false, reason: 'wrong-action' })
  expect(await real({ hostname: 'evil.example', action: 'contact' })).toEqual({
    ok: false,
    reason: 'wrong-hostname',
  })
  expect(await real({ action: 'contact' })).toEqual({ ok: false, reason: 'wrong-hostname' })
})

test('a missing secret, hostname list or token refuses without a request', async () => {
  const never: typeof fetch = () => {
    throw new Error('siteverify must not be called')
  }
  const ask = (check: Partial<TurnstileCheck>) => real({}, { fetch: never, ...check })
  expect(await ask({ secret: undefined })).toEqual({ ok: false, reason: 'not-configured' })
  expect(await ask({ secret: '' })).toEqual({ ok: false, reason: 'not-configured' })
  expect(await ask({ hostnames: [] })).toEqual({ ok: false, reason: 'not-configured' })
  expect(await ask({ hostnames: [' '] })).toEqual({ ok: false, reason: 'not-configured' })
  expect(await ask({ token: undefined })).toEqual({ ok: false, reason: 'missing-token' })
  expect(await ask({ token: '' })).toEqual({ ok: false, reason: 'missing-token' })
})

test('a siteverify that refuses, fails, answers nonsense or takes too long refuses', async () => {
  expect(
    await real(
      {},
      { fetch: answering({ success: false, 'error-codes': ['invalid-input-response'] }) },
    ),
  ).toEqual({ ok: false, reason: 'rejected' })
  expect(await real({}, { fetch: answering({ success: 'true' }) })).toEqual({
    ok: false,
    reason: 'rejected',
  })
  expect(await real({}, { fetch: answering(null) })).toEqual({ ok: false, reason: 'unavailable' })
  expect(await real({}, { fetch: async () => new Response('<html>', { status: 502 }) })).toEqual({
    ok: false,
    reason: 'unavailable',
  })
  expect(await real({}, { fetch: () => Promise.reject(new Error('network down')) })).toEqual({
    ok: false,
    reason: 'unavailable',
  })
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
    })
  expect(await real({}, { fetch: hanging, timeoutMs: 20 })).toEqual({
    ok: false,
    reason: 'unavailable',
  })
})

test("Cloudflare's always-pass secret passes its answer, which has example.com and no action", async () => {
  const check = {
    secret: passSecret,
    hostnames: ['127.0.0.1'],
    action: 'contact',
    token: 'XXXX.DUMMY.TOKEN.XXXX',
  }
  expect(
    await verifyTurnstile({
      ...check,
      fetch: answering({ success: true, hostname: 'example.com', 'error-codes': [] }),
    }),
  ).toEqual({ ok: true })
  expect(
    await verifyTurnstile({
      ...check,
      fetch: answering({ success: false, 'error-codes': ['invalid-input-response'] }),
    }),
  ).toEqual({ ok: false, reason: 'rejected' })
  expect(await verifyTurnstile({ ...check, hostnames: [] })).toEqual({
    ok: false,
    reason: 'not-configured',
  })
})
