#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as PgClient from '@effect/sql-pg/PgClient'
import { Effect, Layer, Redacted } from 'effect'
import { CurrentActor, systemActor } from './authz.ts'
import { Composed, type ComposedServer } from './compose.ts'
import { migrate } from './migrate.ts'

const usage = `Usage:
  opulon migrate --server <file exporting the composed server>
  opulon <module id> <command> --server <file> [options]   (commands the modules declare)`

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

// First pass: find the command, so its own options can be parsed strictly afterwards.
const [moduleId, commandName] = parseArgs({ allowPositionals: true, strict: false }).positionals
const serverPath = parseArgs({
  allowPositionals: true,
  strict: false,
  options: { server: { type: 'string' } },
}).values.server
if (!moduleId || typeof serverPath !== 'string') fail(usage)

const url = process.env.DATABASE_URL_DIRECT
if (!url) fail('DATABASE_URL_DIRECT is not set (the direct Postgres URL, not Hyperdrive).')

const imported: { server?: ComposedServer; default?: ComposedServer } = await import(
  pathToFileURL(resolve(String(serverPath))).href
)
const server = imported.server ?? imported.default
if (!server?.modules)
  fail(`${serverPath} exports no composed server (export it as "server" or default).`)
const { modules, composed } = server!

const database = PgClient.layer({ url: Redacted.make(url!), maxConnections: 2 })

if (moduleId === 'migrate') {
  try {
    const applied = await Effect.runPromise(migrate(modules).pipe(Effect.provide(database)))
    for (const { module, migrations } of applied) {
      const list = migrations.map(([id, name]) => `${id}_${name}`).join(', ')
      console.log(`${module}: ${list || 'up to date'}`)
    }
  } catch (error) {
    console.error('opulon migrate failed:', error)
    process.exit(1)
  }
} else {
  const commands = modules.find((m) => m.id === moduleId)?.commands ?? {}
  const command = commandName ? commands[commandName] : undefined
  if (!command) {
    const known = Object.entries(commands).map(
      ([n, c]) => `  opulon ${moduleId} ${n}: ${c.description}`,
    )
    fail(known.length ? `Commands of ${moduleId}:\n${known.join('\n')}` : usage)
  }
  let values: Record<string, string | boolean | undefined> = {}
  try {
    values = parseArgs({
      allowPositionals: true,
      options: { ...command!.options, server: { type: 'string' } },
    }).values
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  try {
    const output = await Effect.runPromise(
      command!
        .run(values)
        .pipe(
          Effect.provideService(CurrentActor, systemActor('CLI')),
          Effect.provide(Layer.merge(database, Layer.succeed(Composed, composed))),
        ),
    )
    console.log(output)
  } catch (error) {
    console.error(`opulon ${moduleId} ${commandName} failed:`, error)
    process.exit(1)
  }
}
