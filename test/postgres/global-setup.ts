import { randomBytes } from 'node:crypto'
import type { TestProject } from 'vitest/node'
import { adminQuery } from './admin.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
    pgPrefix: string
  }
}

// Creates one template database per test run; every test file clones it (see ./index.ts).
export default async function setup(project: TestProject) {
  const adminUrl = process.env.DATABASE_URL_TEST
  if (!adminUrl) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Point it at a Postgres 17 server (see CONTRIBUTING.md).',
    )
  }
  const [row] = await adminQuery<{ v: string }>(
    adminUrl,
    "select current_setting('server_version_num') as v",
  )
  if (!(Number(row?.v) >= 170000))
    throw new Error(`Tests need Postgres 17, server reports ${row?.v}.`)

  // Unique per run, so parallel runs (other worktrees, CI) can share one server.
  const prefix = `tspack_${randomBytes(4).toString('hex')}`
  await adminQuery(adminUrl, `create database "${prefix}_template"`)
  // Package migrations will be applied to the template here, through the core migrator.

  project.provide('pgAdminUrl', adminUrl)
  project.provide('pgPrefix', prefix)

  return async () => {
    const dbs = await adminQuery<{ datname: string }>(
      adminUrl,
      `select datname from pg_database where starts_with(datname, '${prefix}_')`,
    )
    for (const { datname } of dbs) {
      await adminQuery(adminUrl, `drop database if exists "${datname}" with (force)`)
    }
  }
}
