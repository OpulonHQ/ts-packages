import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { AuditPage, auditDefaultPerPage, type AuditQuery } from './api.ts'
import { requirePermission } from './authz.ts'

export const listAudit = Effect.fn('Audit.list')(
  function* ({
    query,
    ipRetentionDays,
  }: {
    readonly query: AuditQuery
    readonly ipRetentionDays: number
  }) {
    yield* requirePermission('core.audit.view')
    const sql = yield* SqlClient
    const page = query.page ?? 1
    const perPage = query.perPage ?? auditDefaultPerPage
    const actor = query.actor?.trim()
    const module = query.module?.trim()
    const action = query.action?.trim()
    const subjectType = query.subjectType?.trim()
    const subjectId = query.subjectId?.trim()
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
      ...(module ? [sql`split_part(action, '.', 1) = ${module}`] : []),
      ...(action ? [sql`action = ${action}`] : []),
      ...(subjectType ? [sql`subject_type = ${subjectType}`] : []),
      ...(subjectId ? [sql`subject_id = ${subjectId}`] : []),
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
      'context', context,
      'ip', case when occurred_at >= now() - make_interval(days => ${ipRetentionDays}) then ip end,
      'userAgent', case when occurred_at >= now() - make_interval(days => ${ipRetentionDays}) then user_agent end
    ) order by occurred_at desc, id desc) from paged), '[]'::jsonb) as rows`
    return yield* Schema.decodeUnknownEffect(AuditPage)(result[0])
  },
  Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
)
