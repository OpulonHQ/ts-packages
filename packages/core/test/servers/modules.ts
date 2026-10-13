import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { defineModule, type Migrations } from '../../src/index.ts'

// Migration-only modules for the `opulon migrate` tests.
export const migrationsOnly = (
  id: string,
  migrations: Migrations,
  dependsOn: ReadonlyArray<string> = [],
) => defineModule({ id, dependsOn, groups: [], handlers: () => Layer.empty, migrations })

export const run = (statement: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    yield* sql.unsafe(statement)
  })

export const files = migrationsOnly('files', {
  '1_create_file': run('create table files.file (id integer primary key)'),
  '2_seed_file': run('insert into files.file values (1)'),
})

// References files.file, so it only migrates after files. (Ids avoid package ids: the test
// template already holds the real packages' schemas.)
export const pages = migrationsOnly(
  'pages',
  {
    '1_create_page': run(
      'create table pages.page (id integer primary key, file integer references files.file)',
    ),
  },
  ['files'],
)
