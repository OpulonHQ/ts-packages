import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// No FKs on purpose: audit outlives what it describes (TSPACK-14).
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table core.audit_event (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    actor_kind text not null check (actor_kind in ('user', 'system', 'anonymous')),
    actor_id text,
    actor_name text,
    action text not null,
    subject_type text,
    subject_id text,
    subject_label text,
    changes jsonb,
    context jsonb,
    ip text,
    user_agent text
  )`
  yield* sql`create index audit_event_occurred_at on core.audit_event (occurred_at)`
  yield* sql`create index audit_event_subject on core.audit_event (subject_type, subject_id)`
})
