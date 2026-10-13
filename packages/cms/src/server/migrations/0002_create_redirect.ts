import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// Exact-path redirects per content locale (TSPACK-11 decision 10). Paths are locale-relative,
// like cms.path. The service keeps them flat: no redirect points at another redirect's path.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table cms.redirect (
    id uuid primary key,
    locale text not null,
    from_path text not null,
    to_path text not null,
    status smallint not null check (status in (301, 302)),
    auto boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (locale, from_path)
  )`
})
