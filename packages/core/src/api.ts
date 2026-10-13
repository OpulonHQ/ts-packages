// Client-safe entry for module `/api` files (HttpApi groups), imported by browser builds too.
// Keep server-only code (composition, migrations, SQL) out of this graph; CI checks it.
import { Schema } from 'effect'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { Authorization, Policy } from './authz.ts'

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
export const CachePurgeStatus = Schema.Struct({
  summary: CachePurgeSummary,
  rows: Schema.Array(
    Schema.Struct({
      id: PendingCachePurge.fields.id,
      attempts: PendingCachePurge.fields.attempts,
      state: PendingCachePurge.fields.state,
      error: PendingCachePurge.fields.error,
      staleUntil: PendingCachePurge.fields.staleUntil,
    }),
  ),
})
export type CachePurgeStatus = typeof CachePurgeStatus.Type

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

/** Immutable actor, subject and change snapshots; retention may remove IP and user agent.
 * Missing historical change values are returned as null. */
export const AuditEvent = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  actor: Schema.Struct({
    kind: Schema.Literals(['user', 'system', 'anonymous']),
    id: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
  }),
  action: Schema.String,
  subject: Schema.Struct({
    type: Schema.NullOr(Schema.String),
    id: Schema.NullOr(Schema.String),
    label: Schema.NullOr(Schema.String),
  }),
  changes: Schema.Array(
    Schema.Struct({ field: Schema.String, from: Schema.Unknown, to: Schema.Unknown }),
  ),
  context: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ip: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
})
export type AuditEvent = typeof AuditEvent.Type

export const AuditPage = Schema.Struct({ rows: Schema.Array(AuditEvent), total: Schema.Number })
export type AuditPage = typeof AuditPage.Type

export const auditMaxOffset = 10_000

const filterText = Schema.String.check(Schema.isMaxLength(500))
const timestamp = Schema.String.check(
  Schema.makeFilter<string>((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) return false
    const date = new Date(value)
    const canonical = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() >= 1 &&
      date.toISOString() === canonical
    )
  }),
)

/** Actor matches kind/id/name text; module/action and subject type/id match exactly.
 * Subject label matches text. UTC ISO start is inclusive; end is exclusive.
 * Paging offsets cannot exceed auditMaxOffset. */
export const AuditQuery = Schema.Struct({
  page: Schema.optionalKey(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: auditMaxOffset + 1 }),
    ),
  ),
  perPage: Schema.optionalKey(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  actor: Schema.optionalKey(filterText),
  module: Schema.optionalKey(filterText),
  action: Schema.optionalKey(filterText),
  subjectType: Schema.optionalKey(filterText),
  subjectId: Schema.optionalKey(filterText),
  subjectLabel: Schema.optionalKey(filterText),
  start: Schema.optionalKey(timestamp),
  end: Schema.optionalKey(timestamp),
}).check(
  Schema.makeFilter(
    (query) =>
      ((query.page ?? 1) - 1) * (query.perPage ?? 25) <= auditMaxOffset &&
      (!query.start || !query.end || Date.parse(query.start) < Date.parse(query.end)),
  ),
)
export type AuditQuery = typeof AuditQuery.Type

/** Core's group. Unlike other modules it is mounted at the API prefix itself: `/api/me`. */
export const CoreGroup = HttpApiGroup.make('core')
  .add(HttpApiEndpoint.get('me', '/me', { success: Me }).annotate(Policy, 'signedIn'))
  .add(
    HttpApiEndpoint.get('cachePurges', '/cache-purges', {
      success: CachePurgeStatus,
    }).annotate(Policy, 'signedIn'),
  )
  .add(
    HttpApiEndpoint.get('audit', '/audit', { query: AuditQuery, success: AuditPage }).annotate(
      Policy,
      'core.audit.view',
    ),
  )
  .middleware(Authorization)
