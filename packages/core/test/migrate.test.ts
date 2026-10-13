import pg from 'pg'
import { describe, expect, test } from 'vitest'
import { runOpulon } from '../../../test/opulon.ts'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { createTestDatabase } from '../../../test/postgres/index.ts'

const servers = 'packages/core/test/servers'

const migrateWith = (url: string, server: string) =>
  runOpulon(['migrate', '--server', `${servers}/${server}.ts`], { DATABASE_URL_DIRECT: url })

const schemas = async (url: string) =>
  (
    await adminQuery<{ name: string }>(
      url,
      "select nspname as name from pg_namespace where nspname in ('files', 'pages', 'broken', 'downstream') order by 1",
    )
  ).map((r) => r.name)

describe('opulon migrate', () => {
  test('migrates in dependency order, schema first, with the ledger inside each schema', async () => {
    const db = await createTestDatabase()
    try {
      const { stdout } = await migrateWith(db.url, 'ordered')
      expect(stdout).toBe('files: 1_create_file, 2_seed_file\npages: 1_create_page\n')
      const ledger = await adminQuery<{ module: string; id: number; name: string }>(
        db.url,
        `select 'files' as module, migration_id as id, name from files.migrations
         union all select 'pages', migration_id, name from pages.migrations order by 1, 2`,
      )
      expect(ledger).toEqual([
        { module: 'files', id: 1, name: 'create_file' },
        { module: 'files', id: 2, name: 'seed_file' },
        { module: 'pages', id: 1, name: 'create_page' },
      ])
      expect((await migrateWith(db.url, 'ordered')).stdout).toBe(
        'files: up to date\npages: up to date\n',
      )
    } finally {
      await db.drop()
    }
  })

  test('a failing module rolls back and stops every module after it', async () => {
    const db = await createTestDatabase()
    try {
      const failure = await migrateWith(db.url, 'failing').catch(
        (error: { code: number; stderr: string }) => error,
      )
      expect(failure).toMatchObject({
        code: 1,
        stderr: expect.stringContaining('Migration "2_fails" failed'),
      })
      expect(await schemas(db.url)).toEqual(['broken', 'files'])
      expect(await adminQuery(db.url, "select to_regclass('broken.ok') as t")).toEqual([
        { t: null },
      ])
    } finally {
      await db.drop()
    }
  })

  test('waits for the advisory lock held by another run', async () => {
    const db = await createTestDatabase()
    const holder = new pg.Client({ connectionString: db.url })
    await holder.connect()
    try {
      await holder.query("select pg_advisory_lock(hashtext('opulon.migrate'))")
      let finished = false
      const run = migrateWith(db.url, 'ordered').finally(() => (finished = true))
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(finished).toBe(false)
      expect(await schemas(db.url)).toEqual([])
      await holder.query("select pg_advisory_unlock(hashtext('opulon.migrate'))")
      await run
      expect(await schemas(db.url)).toEqual(['files', 'pages'])
    } finally {
      await holder.end()
      await db.drop()
    }
  })

  test('refuses to run without DATABASE_URL_DIRECT', async () => {
    const failure = await runOpulon(['migrate', '--server', `${servers}/ordered.ts`], {
      DATABASE_URL_DIRECT: '',
    }).catch((error: { code: number; stderr: string }) => error)
    expect(failure).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('DATABASE_URL_DIRECT is not set'),
    })
  })
})
