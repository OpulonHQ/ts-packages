import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// cms documents (TSPACK-11): every editable thing holds a draft and a published JSON document,
// sections inside (no sections table). `kind` is `page` now; collection items, site settings and
// menus become further kinds, `key` naming the system page / collection / menu.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table cms.document (
    id uuid primary key,
    kind text not null,
    key text,
    draft jsonb not null,
    published jsonb,
    published_at timestamptz,
    published_revision_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`
  yield* sql`create unique index document_system_page on cms.document (key)
    where kind = 'page' and key is not null`
  yield* sql`create index document_kind on cms.document (kind, updated_at desc)`
  // A snapshot of what was published, by whom and when. Kept forever (restore UI comes later).
  yield* sql`create table cms.revision (
    id uuid primary key,
    document_id uuid not null references cms.document (id) on delete cascade,
    reason text not null,
    document jsonb not null,
    created_by text,
    created_by_name text not null,
    created_at timestamptz not null default now()
  )`
  yield* sql`create index revision_document on cms.revision (document_id, created_at desc)`
  // Published paths per content locale, for routing (Read API) and redirects on path changes.
  yield* sql`create table cms.path (
    locale text not null,
    path text not null,
    document_id uuid not null references cms.document (id) on delete cascade,
    primary key (locale, path)
  )`
  yield* sql`create index path_document on cms.path (document_id)`
})
