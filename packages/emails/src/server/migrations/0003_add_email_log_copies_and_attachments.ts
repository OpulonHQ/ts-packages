import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`alter table emails.email_log
    add column cc jsonb not null default '[]',
    add column bcc jsonb not null default '[]',
    add column reply_to text,
    add column attachments jsonb not null default '[]'`
})
