import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// The email log is the outbox (ADR 0002). `message` holds the rendered email only while it
// waits for delivery and is cleared once the row is sent, failed or skipped; placeholder
// values are never stored. No FKs: `about_*` points anywhere, like audit subjects.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table emails.email_log (
    id uuid primary key default gen_random_uuid(),
    template_key text not null,
    locale text not null,
    recipients jsonb not null,
    subject text not null,
    status text not null default 'queued'
      check (status in ('queued', 'sent', 'failed', 'skipped')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    message jsonb,
    provider_message_id text,
    error text,
    about_type text,
    about_id text,
    created_at timestamptz not null default now(),
    sent_at timestamptz
  )`
  yield* sql`create index email_log_due on emails.email_log (next_attempt_at)
    where status = 'queued'`
  yield* sql`create index email_log_created_at on emails.email_log (created_at)`
})
