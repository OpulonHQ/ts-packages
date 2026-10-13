import { useApiClient } from '@opulonjs/admin'
import { Effect, Result } from 'effect'
import { UsersAuthGroup } from '../api.ts'

type Runner = ReturnType<typeof useApiClient<typeof UsersAuthGroup>>
type Client = Parameters<Parameters<Runner>[0]>[0]

export type Outcome<A> =
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly tag: string }

/**
 * Calls the public users endpoints and names the outcome: the value, or the failure's tag
 * (`Unauthorized`, `TooManyRequests`, `InvalidToken`, ...; `failed` when the server is unreachable).
 */
export const useAuthClient = () => {
  const run = useApiClient(UsersAuthGroup)
  return <A>(call: (client: Client) => Effect.Effect<A, { readonly _tag: string }>) =>
    run((client) => Effect.result(call(client))).then(
      (result): Outcome<A> =>
        Result.isSuccess(result)
          ? { ok: true, value: result.success }
          : { ok: false, tag: result.failure._tag },
      (): Outcome<A> => ({ ok: false, tag: 'failed' }),
    )
}

/** The token of an emailed link (`#token=...`), read once and removed from the address bar. */
export const takeToken = (hash: string): string | undefined => {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? undefined
  if (token) history.replaceState(history.state, '', location.pathname + location.search)
  return token
}

/** A redirect inside the admin only: an absolute admin path, never another origin. */
export const safeRedirect = (value: unknown) =>
  typeof value === 'string' && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : '/'
