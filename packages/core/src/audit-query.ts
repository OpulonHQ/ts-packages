import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { AuditPage, type AuditQuery } from './api.ts'
import { requirePermission } from './authz.ts'

export const listAudit = Effect.fn('Audit.list')(
  function* (query: AuditQuery) {
    yield* requirePermission('core.audit.view')
    const sql = yield* SqlClient
    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    const actor = query.actor?.trim()
    const label = query.subjectLabel?.trim()
    const where = sql.and([
      sql`true`,
      ...(actor
        ? [
            sql`(strpos(lower(actor_kind), lower(${actor})) > 0
      or strpos(lower(actor_id), lower(${actor})) > 0
      or strpos(lower(actor_name), lower(${actor})) > 0)`,
          ]
        : []),
      ...(query.module ? [sql`split_part(action, '.', 1) = ${query.module}`] : []),
      ...(query.action ? [sql`action = ${query.action}`] : []),
      ...(query.subjectType ? [sql`subject_type = ${query.subjectType}`] : []),
      ...(query.subjectId ? [sql`subject_id = ${query.subjectId}`] : []),
      ...(label ? [sql`strpos(lower(subject_label), lower(${label})) > 0`] : []),
      ...(query.start ? [sql`occurred_at >= ${query.start}::timestamptz`] : []),
      ...(query.end ? [sql`occurred_at < ${query.end}::timestamptz`] : []),
    ])
    const result = yield* sql`with filtered as not materialized (
    select * from core.audit_event where ${where}
  ), paged as (
    select * from filtered order by occurred_at desc, id desc
    limit ${perPage} offset ${(page - 1) * perPage}
  ) select (select count(*)::float8 from filtered) as total,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', id::text,
      'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actor', jsonb_build_object('kind', actor_kind, 'id', actor_id, 'name', actor_name),
      'action', action,
      'subject', jsonb_build_object('type', subject_type, 'id', subject_id, 'label', subject_label),
      'changes', coalesce((select jsonb_agg(
        '{"from":null,"to":null}'::jsonb || value order by position)
        from jsonb_array_elements(changes) with ordinality as change(value, position)), '[]'::jsonb),
      'context', context, 'ip', ip, 'userAgent', user_agent
    ) order by occurred_at desc, id desc) from paged), '[]'::jsonb) as rows`
    return yield* Schema.decodeUnknownEffect(AuditPage)(result[0])
  },
  Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
)
