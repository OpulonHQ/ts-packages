import { Context, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import { Forbidden, Unauthorized } from 'effect/http-api/HttpApiError'
import * as HttpApiMiddleware from 'effect/http-api/HttpApiMiddleware'

/** A signed-in staff user, as the auth implementation (users) resolves it per request. */
export interface User {
  readonly id: string
  readonly name: string
  readonly email: string
  /** The user's admin locale; null means the admin default. */
  readonly locale: string | null
  /** Permission keys the user holds (Super admin: the whole composed catalog). */
  readonly permissions: ReadonlyArray<string>
}

/** The signed-in staff user of the current request, provided by the Authorization middleware. */
export class CurrentUser extends Context.Service<CurrentUser, User>()(
  '@opulonjs/core/CurrentUser',
) {}

/**
 * Who performs the current work: a signed-in staff user, the system (scheduled tasks, webhooks)
 * or nobody known (public requests). `name` is snapshotted into audit events.
 */
export type Actor =
  | {
      readonly kind: 'user'
      readonly id: string
      readonly name: string
      readonly permissions: ReadonlyArray<string>
    }
  | { readonly kind: 'system'; readonly name: string }
  | { readonly kind: 'anonymous'; readonly name?: string }

/** The system actor. It bypasses permission checks, so provide it only on purpose. */
export const systemActor = (name = 'System'): Actor => ({ kind: 'system', name })

/**
 * The actor of the current work. Defaults to anonymous, so anything not run behind the
 * Authorization middleware or as a task fails `requirePermission` (fail closed).
 */
export const CurrentActor = Context.Reference<Actor>('@opulonjs/core/CurrentActor', {
  defaultValue: () => ({ kind: 'anonymous' }),
})

/**
 * Checks a permission inside a privileged service, whoever calls it: a user must hold `key`,
 * the system actor passes, anonymous callers (public handlers) are refused.
 */
export const requirePermission = (key: string): Effect.Effect<void, Forbidden> =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    if (actor.kind === 'system') return
    if (actor.kind === 'user' && actor.permissions.includes(key)) return
    return yield* new Forbidden()
  })

/**
 * The auth middleware every non-public group carries. users implements it; until then a host
 * (or a test) provides it with `authorization(authenticate)`.
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser }
>()('@opulonjs/core/Authorization', { error: [Unauthorized, Forbidden] }) {}

/** Endpoint annotation: the one policy guarding it, a permission key or `signedIn`. */
export class Policy extends Context.Service<Policy, string>()('@opulonjs/core/Policy') {}

/**
 * Group annotation: the group is public on purpose and carries no auth; composition refuses
 * the Authorization middleware or a Policy on its endpoints.
 */
export class Public extends Context.Service<Public, true>()('@opulonjs/core/Public') {}

/**
 * Builds the Authorization middleware from a session lookup. A request without a user gets 401;
 * a user without the endpoint's policy permission gets 403. A missing policy fails closed. The
 * handler runs with the user as CurrentUser and as CurrentActor.
 */
export const authorization = <R>(
  authenticate: (request: HttpServerRequest) => Effect.Effect<User | undefined, never, R>,
) =>
  Layer.effect(
    Authorization,
    Effect.map(Effect.context<R>(), (context) =>
      Authorization.of((httpEffect, { endpoint }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest
          const user = yield* authenticate(request).pipe(Effect.provideContext(context))
          if (!user) return yield* new Unauthorized()
          const policy = Context.getOption(endpoint.annotations, Policy)
          if (Option.isNone(policy)) return yield* new Forbidden()
          if (policy.value !== 'signedIn' && !user.permissions.includes(policy.value)) {
            return yield* new Forbidden()
          }
          const actor: Actor = {
            kind: 'user',
            id: user.id,
            name: user.name,
            permissions: user.permissions,
          }
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentUser, user),
            Effect.provideService(CurrentActor, actor),
          )
        }),
      ),
    ),
  )
