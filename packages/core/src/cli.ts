#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as PgClient from '@effect/sql-pg/PgClient'
import { Effect, Redacted } from 'effect'
import type { ComposedServer } from './compose.ts'
import { migrate } from './migrate.ts'

const usage = 'Usage: opulon migrate --server <file exporting the composed server>'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { server: { type: 'string' } },
})

if (positionals[0] !== 'migrate' || !values.server) {
  console.error(usage)
  process.exit(2)
}
const url = process.env.DATABASE_URL_DIRECT
if (!url) {
  console.error('DATABASE_URL_DIRECT is not set (the direct Postgres URL, not Hyperdrive).')
  process.exit(2)
}

const imported: { server?: ComposedServer; default?: ComposedServer } = await import(
  pathToFileURL(resolve(values.server)).href
)
const server = imported.server ?? imported.default
if (!server?.modules) {
  console.error(`${values.server} exports no composed server (export it as "server" or default).`)
  process.exit(2)
}

try {
  const applied = await Effect.runPromise(
    migrate(server.modules).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url), maxConnections: 2 })),
    ),
  )
  for (const { module, migrations } of applied) {
    const list = migrations.map(([id, name]) => `${id}_${name}`).join(', ')
    console.log(`${module}: ${list || 'up to date'}`)
  }
} catch (error) {
  console.error('opulon migrate failed:', error)
  process.exit(1)
}
