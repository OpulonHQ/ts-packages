import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, inject } from 'vitest'
import { adminQuery, databaseUrl } from './admin.ts'

export interface TestDatabase {
  name: string
  url: string
  drop: () => Promise<void>
}

/** Clones the run's template into a fresh database. Call `drop` when done. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl')
  const prefix = inject('pgPrefix')
  const name = `${prefix}_${randomBytes(6).toString('hex')}`
  await adminQuery(adminUrl, `create database "${name}" template "${prefix}_template"`)
  return {
    name,
    url: databaseUrl(adminUrl, name),
    drop: async () => {
      await adminQuery(adminUrl, `drop database if exists "${name}" with (force)`)
    },
  }
}

/** One database per test file: created in beforeAll, dropped in afterAll. Read `url` inside tests. */
export function useTestDatabase(): { readonly url: string } {
  let db: TestDatabase | undefined
  beforeAll(async () => {
    db = await createTestDatabase()
  })
  afterAll(() => db?.drop())
  return {
    get url() {
      if (!db) throw new Error('useTestDatabase().url is only available inside tests.')
      return db.url
    },
  }
}
