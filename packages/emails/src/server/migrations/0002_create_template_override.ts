import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// Templates live in code; the DB keeps only what staff changed: per-locale overrides (reset
// deletes the row) and the templates switched off. Keys of templates no longer contributed are
// ignored, so a module can drop a template without a data migration.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table emails.template_override (
    template_key text not null,
    locale text not null,
    subject text not null,
    body text not null,
    updated_at timestamptz not null default now(),
    primary key (template_key, locale)
  )`
  yield* sql`create table emails.disabled_template (
    template_key text primary key,
    disabled_at timestamptz not null default now()
  )`
})
