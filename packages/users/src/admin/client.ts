import { useApiClient } from '@opulonjs/admin'
import { Effect, Result } from 'effect'
import { Refused, UsersAuthGroup, UsersGroup } from '../api.ts'

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

/** The staff users endpoints (users, roles, locale). */
export const useUsersClient = () => useApiClient(UsersGroup)

/** The message key for a failed users or roles change: the guard's reason when it refused. */
export const failureKey = (error: unknown) =>
  error instanceof Refused ? `users.refused.${error.reason}` : 'users.errors.failed'

/** A locale's own name, e.g. `slovenčina` for `sk`. */
export const localeName = (locale: string) =>
  new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
