const siteverify = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const dummySecret = /^[123]x0{31}AA$/

export interface TurnstileCheck {
  /** The widget's secret key. Missing or empty refuses every token. */
  readonly secret: string | undefined
  /** Hostnames a token may come from, e.g. `['example.com']`. Empty refuses every token. */
  readonly hostnames: ReadonlyArray<string>
  /** The action the widget was rendered with. */
  readonly action: string
  /** The token the widget produced. */
  readonly token: string | undefined
  /** The visitor's address, e.g. the `cf-connecting-ip` header. */
  readonly remoteIp?: string | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
  /** How long to wait for siteverify; default 5000. */
  readonly timeoutMs?: number | undefined
}

export type TurnstileResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      /** For the server log only; answer the visitor the same for every reason. */
      readonly reason:
        | 'not-configured'
        | 'missing-token'
        | 'rejected'
        | 'wrong-action'
        | 'wrong-hostname'
        | 'unavailable'
    }

const refused = (reason: Exclude<TurnstileResult, { ok: true }>['reason']): TurnstileResult => ({
  ok: false,
  reason,
})

/**
 * Checks a Cloudflare Turnstile token with siteverify and compares the action and the hostname
 * it was solved for. Never throws: a missing secret, hostname list or token, a siteverify that
 * times out, fails or answers anything but a success, all refuse. A token passes once, so call
 * this once per form post.
 *
 * Cloudflare's dummy secret keys (`1x0000000000000000000000000000000AA` always passes) answer
 * hostname `example.com` and no action, so with one of them those two comparisons are skipped.
 */
export const verifyTurnstile = async (check: TurnstileCheck): Promise<TurnstileResult> => {
  const hostnames = check.hostnames.map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (!check.secret || hostnames.length === 0) return refused('not-configured')
  if (!check.token) return refused('missing-token')
  const form = new URLSearchParams({ secret: check.secret, response: check.token })
  if (check.remoteIp) form.set('remoteip', check.remoteIp)
  let answer: unknown
  try {
    const response = await (check.fetch ?? globalThis.fetch)(siteverify, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(check.timeoutMs ?? 5000),
    })
    if (!response.ok) return refused('unavailable')
    answer = await response.json()
  } catch {
    return refused('unavailable')
  }
  if (typeof answer !== 'object' || answer === null) return refused('unavailable')
  const { success, action, hostname } = answer as Record<string, unknown>
  if (success !== true) return refused('rejected')
  if (dummySecret.test(check.secret)) return { ok: true }
  if (action !== check.action) return refused('wrong-action')
  if (typeof hostname !== 'string' || !hostnames.includes(hostname.toLowerCase()))
    return refused('wrong-hostname')
  return { ok: true }
}
