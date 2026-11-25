import { vi } from 'vitest'

export const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare's documented dummy keys (developers.cloudflare.com/turnstile/troubleshooting/testing). */
export const dummy = {
  siteKey: '1x00000000000000000000AA',
  passSecret: '1x0000000000000000000000000000000AA',
  failSecret: '2x0000000000000000000000000000000AA',
  spentSecret: '3x0000000000000000000000000000000AA',
  token: 'XXXX.DUMMY.TOKEN.XXXX',
} as const

/** What siteverify answers for a dummy secret, as Cloudflare documents it. */
const cloudflare = (form: URLSearchParams) => {
  const secret = form.get('secret')
  if (secret === dummy.passSecret && form.get('response') === dummy.token)
    return Response.json({
      success: true,
      challenge_ts: new Date().toISOString(),
      hostname: 'example.com',
      'error-codes': [],
      metadata: { result_with_testing_key: true },
    })
  return Response.json({
    success: false,
    'error-codes': [
      secret === dummy.spentSecret
        ? 'timeout-or-duplicate'
        : secret === dummy.passSecret || secret === dummy.failSecret
          ? 'invalid-input-response'
          : 'invalid-input-secret',
    ],
  })
}

/**
 * Replaces the global `fetch` with a siteverify that answers like Cloudflare's dummy secrets, or
 * as `answer` says. Any other URL throws, so a test never reaches the network. Resolves with the
 * forms it received. Undo with `vi.unstubAllGlobals()`.
 */
export function stubSiteverify(
  answer: (form: URLSearchParams, signal: AbortSignal) => Response | Promise<Response> = cloudflare,
) {
  const calls: Array<URLSearchParams> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (request.url !== siteverifyUrl || request.method !== 'POST')
      throw new Error(`unexpected fetch: ${request.method} ${request.url}`)
    const form = new URLSearchParams(await request.text())
    calls.push(form)
    return answer(form, request.signal)
  })
  return calls
}
