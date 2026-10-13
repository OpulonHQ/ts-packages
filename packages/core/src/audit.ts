import { Effect } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import { SqlClient } from 'effect/sql/SqlClient'
import { CurrentActor } from './authz.ts'
import { Composed } from './compose.ts'

/** One changed scalar field. Values longer than 500 characters are truncated when recorded. */
export interface AuditChange {
  readonly field: string
  readonly from: unknown
  readonly to: unknown
}

export interface AuditInput {
  /** A key the module declared in `auditActions`, e.g. `cms.page.published`. */
  readonly action: string
  /** What the event is about; the label is a snapshot (e.g. the page title at the time). */
  readonly subject?: { readonly type: string; readonly id: string; readonly label?: string }
  /** Changed scalar fields only (see diffFields). Never pass secrets or hashes. */
  readonly changes?: ReadonlyArray<AuditChange>
  /** Extra references, e.g. `{ revisionId }`. */
  readonly context?: Readonly<Record<string, unknown>>
}

const maxValue = 500
const truncate = (value: unknown) =>
  typeof value === 'string' && value.length > maxValue ? `${value.slice(0, maxValue)}…` : value

/** The changes between two versions of a record, limited to the given scalar fields. */
export const diffFields = <T extends object>(
  before: T,
  after: T,
  fields: ReadonlyArray<keyof T & string>,
): Array<AuditChange> =>
  fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, from: before[field], to: after[field] }))

export const Audit = {
  /**
   * Appends an audit event through the ambient SqlClient, so it commits or rolls back with the
   * caller's transaction; an insert failure fails the caller. The actor comes from CurrentActor,
   * IP and user agent from the current request (if any). An undeclared action key is a defect.
   */
  record: Effect.fn('Audit.record')(function* (input: AuditInput) {
    const composed = yield* Composed
    if (!composed.auditActions.has(input.action))
      return yield* Effect.die(
        new Error(`audit action "${input.action}" is not declared by any composed module`),
      )
    const actor = yield* CurrentActor
    const request = yield* Effect.serviceOption(HttpServerRequest)
    const header = (name: string) =>
      request._tag === 'Some' ? (request.value.headers[name] ?? null) : null
    const changes = input.changes?.map((c) => ({
      ...c,
      from: truncate(c.from),
      to: truncate(c.to),
    }))
    const sql = yield* SqlClient
    yield* sql`insert into core.audit_event (actor_kind, actor_id, actor_name, action,
        subject_type, subject_id, subject_label, changes, context, ip, user_agent)
      values (${actor.kind}, ${actor.kind === 'user' ? actor.id : null}, ${actor.name ?? null},
        ${input.action}, ${input.subject?.type ?? null}, ${input.subject?.id ?? null},
        ${input.subject?.label ?? null},
        ${changes ? JSON.stringify(changes) : null}::jsonb,
        ${input.context ? JSON.stringify(input.context) : null}::jsonb,
        ${header('cf-connecting-ip')}, ${header('user-agent')})`
  }),
}

const batch = 1000
// ponytail: at most 100 batches (100k rows) per run; the rest waits for the next daily run.
const maxBatches = 100

/**
 * Core's retention task: deletes events older than `retentionDays` and nulls IP and user agent
 * after `ipRetentionDays`, in bounded batches. Idempotent: a second run finds nothing to do.
 */
export const purgeAudit = (o: {
  readonly retentionDays: number
  readonly ipRetentionDays: number
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const inBatches = (step: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      Effect.gen(function* () {
        for (let i = 0; i < maxBatches; i++) if ((yield* step).length < batch) return
      })
    yield* inBatches(sql`
      delete from core.audit_event where id in (
        select id from core.audit_event
        where occurred_at < now() - make_interval(days => ${o.retentionDays})
        limit ${batch})
      returning id`)
    yield* inBatches(sql`
      update core.audit_event set ip = null, user_agent = null where id in (
        select id from core.audit_event
        where occurred_at < now() - make_interval(days => ${o.ipRetentionDays})
          and (ip is not null or user_agent is not null)
        limit ${batch})
      returning id`)
  })
