import { Context, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import { Forbidden, Unauthorized } from 'effect/http-api/HttpApiError'
import * as HttpApiMiddleware from 'effect/http-api/HttpApiMiddleware'

/** The signed-in staff user of the current request, provided by the Authorization middleware. */
export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly permissions: ReadonlyArray<string> }
>()('@opulonjs/core/CurrentUser') {}

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

/** Group annotation: the group is public on purpose and carries no auth. */
export class Public extends Context.Service<Public, true>()('@opulonjs/core/Public') {}

/**
 * Builds the Authorization middleware from a session lookup. A request without a user gets 401;
 * a user without the endpoint's policy permission gets 403. A missing policy fails closed.
 */
export const authorization = <R>(
  authenticate: (
    request: HttpServerRequest,
  ) => Effect.Effect<CurrentUser['Service'] | undefined, never, R>,
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
          return yield* Effect.provideService(httpEffect, CurrentUser, user)
        }),
      ),
    ),
  )
