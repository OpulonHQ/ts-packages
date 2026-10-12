import { afterAll, expect, test } from 'vitest'
import { adminQuery as query } from './postgres/admin.ts'
import { createTestDatabase, useTestDatabase } from './postgres/index.ts'

const db = useTestDatabase()

test('each test file gets its own Postgres 17 database', async () => {
  const [row] = await query<{ v: string }>(
    db.url,
    "select current_setting('server_version_num') as v",
  )
  expect(Number(row!.v)).toBeGreaterThanOrEqual(170000)

  await query(db.url, 'create table note (body text); insert into note values ($$kept$$)')
  expect(await query(db.url, 'select body from note')).toEqual([{ body: 'kept' }])
})

test('a new clone starts from the template, not from another clone', async () => {
  const other = await createTestDatabase()
  afterAll(other.drop)
  expect(other.url).not.toBe(db.url)
  expect(await query(other.url, `select to_regclass('note') as t`)).toEqual([{ t: null }])
})
