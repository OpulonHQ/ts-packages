// Client-safe entry for module `/api` files (HttpApi groups), imported by browser builds too.
// Keep server-only code (composition, migrations, SQL) out of this graph; CI checks it.
import { Schema } from 'effect'

/** Editor-safe summary of a durable cache purge. Provider diagnostics are never returned. */
export const PendingCachePurge = Schema.Struct({
  id: Schema.String,
  tags: Schema.Array(Schema.String),
  attempts: Schema.Number,
  state: Schema.Literals(['queued', 'failed']),
  error: Schema.NullOr(Schema.String),
  staleUntil: Schema.String,
})
export type PendingCachePurge = typeof PendingCachePurge.Type

export const CachePurgeSummary = Schema.Struct({
  total: Schema.Number,
  failed: Schema.Number,
  staleUntil: Schema.NullOr(Schema.String),
})
export type CachePurgeSummary = typeof CachePurgeSummary.Type
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { Authorization, Policy } from './authz.ts'

export { Authorization, CurrentUser, Policy, Public } from './authz.ts'

export const corePermissions = ['core.audit.view'] as const

/** What `<apiPrefix>/me` returns to a signed-in staff user. */
export const Me = Schema.Struct({
  /** The server's build id; the admin compares it with its own to ask for a reload. */
  buildId: Schema.String,
  user: Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String }),
  /** The user's admin locale; null means the admin default. */
  locale: Schema.NullOr(Schema.String),
  /** Permission keys the user holds. */
  permissions: Schema.Array(Schema.String),
  /** Ids of the composed (enabled) modules. */
  modules: Schema.Array(Schema.String),
  /** Every permission key the composed modules declare; labels live in admin messages. */
  permissionCatalog: Schema.Array(Schema.String),
  /** The host's content locales, first = default (`composeServer({ contentLocales })`). */
  contentLocales: Schema.Array(Schema.String),
})
export type Me = typeof Me.Type

/** Core's group. Unlike other modules it is mounted at the API prefix itself: `/api/me`. */
export const CoreGroup = HttpApiGroup.make('core')
  .add(HttpApiEndpoint.get('me', '/me', { success: Me }).annotate(Policy, 'signedIn'))
  .middleware(Authorization)
