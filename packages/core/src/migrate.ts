import { Effect } from 'effect'
import * as Migrator from 'effect/sql/Migrator'
import { SqlClient } from 'effect/sql/SqlClient'
import type { Module } from './module.ts'

/** Name of the session advisory lock held for a whole run (keyed by hashtext). */
const lockName = 'opulon.migrate'

export interface Applied {
  readonly module: string
  readonly migrations: ReadonlyArray<readonly [id: number, name: string]>
}

/**
 * Migrates modules in the given (topological) order under one advisory lock. Each module gets its
 * schema first, keeps its ledger in `<id>.migrations` and migrates in its own transaction. The
 * first failure stops the run, so no later (downstream) module migrates.
 */
export const migrate = (modules: ReadonlyArray<Module>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient
      // The lock lives on one reserved session; migrations run on other pool connections.
      const lock = yield* sql.reserve
      yield* lock.executeRaw('select pg_advisory_lock(hashtext($1))', [lockName])
      yield* Effect.addFinalizer(() =>
        lock.executeRaw('select pg_advisory_unlock(hashtext($1))', [lockName]).pipe(Effect.ignore),
      )
      const applied: Array<Applied> = []
      for (const m of modules) {
        if (Object.keys(m.migrations).length === 0) continue
        yield* sql`create schema if not exists ${sql(m.id)}`
        const migrations = yield* Migrator.make({})({
          loader: Migrator.fromRecord(m.migrations),
          table: `${m.id}.migrations`,
        })
        applied.push({ module: m.id, migrations })
      }
      return applied
    }),
  )
