import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// The flat media library (TSPACK-13). Rows are never deleted: archiving sets archived_at, and
// cms references media.item(id) with RESTRICT.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table media.item (
    id uuid primary key,
    version integer not null default 1,
    filename text not null,
    mime text not null,
    size integer not null,
    width integer,
    height integer,
    alt jsonb not null default '{}',
    caption jsonb not null default '{}',
    uploaded_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz
  )`
  yield* sql`create index item_created_at on media.item (created_at desc)`
})
