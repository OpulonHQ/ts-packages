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

export const media = migrationsOnly('media', {
  '1_create_file': run('create table media.file (id integer primary key)'),
  '2_seed_file': run('insert into media.file values (1)'),
})

// References media.file, so it only migrates after media.
export const cms = migrationsOnly(
  'cms',
  {
    '1_create_page': run(
      'create table cms.page (id integer primary key, file integer references media.file)',
    ),
  },
  ['media'],
)
