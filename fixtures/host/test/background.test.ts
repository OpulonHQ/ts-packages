import * as PgClient from '@effect/sql-pg/PgClient'
import {
  Background,
  composeServer,
  defineModule,
  migrate,
  Public,
  withTransaction,
} from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Redacted, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { SqlClient } from 'effect/sql/SqlClient'
import { beforeAll, expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'

// A module whose endpoints open transactions and queue afterCommit work. The queued work records
// how many notes it can see, which tells when (and outside which transaction) it ran.
const scenarios = ['commit', 'nested', 'rollback', 'savepoint', 'none'] as const

const BgGroup = HttpApiGroup.make('bg')
  .add(
    HttpApiEndpoint.post('run', '/run/:scenario', {
      params: { scenario: Schema.Literals(scenarios) },
    }),
  )
  .add(
    HttpApiEndpoint.get('events', '/events', {
      success: Schema.Array(Schema.Struct({ label: Schema.String, seen: Schema.Number })),
    }),
  )
  .annotate(Public, true)

const boom = Effect.fail(new Error('boom'))

const scenario = (name: (typeof scenarios)[number]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const note = sql`insert into bg.note default values`
    const queue = (label: string) =>
      Background.afterCommit(
        sql`insert into bg.event (label, seen) select ${label}, count(*) from bg.note`,
      )
    switch (name) {
      case 'commit':
        return yield* withTransaction(Effect.all([note, queue('commit'), note]))
      case 'nested':
        return yield* withTransaction(Effect.all([withTransaction(queue('nested')), note]))
      case 'rollback':
        return yield* withTransaction(Effect.all([note, queue('rollback'), boom])).pipe(
          Effect.ignore,
        )
      case 'savepoint':
        return yield* withTransaction(
          Effect.all([
            withTransaction(Effect.all([queue('rolled back'), boom])).pipe(Effect.ignore),
            note,
            queue('kept'),
          ]),
        )
      case 'none':
        return yield* Effect.all([queue('none'), note])
    }
  }).pipe(Effect.orDie, Effect.asVoid)

const bg = defineModule({
  id: 'bg',
  groups: [BgGroup],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'bg', (h) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient
        return h
          .handle('run', ({ params }) => scenario(params.scenario))
          .handle('events', () =>
            sql<{ label: string; seen: number }>`
              select label, seen from bg.event order by id`.pipe(Effect.orDie),
          )
      }),
    ),
  migrations: {
    '0001_create': Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`create table bg.note (id integer generated always as identity primary key)`
      yield* sql`create table bg.event (id integer generated always as identity primary key,
        label text not null, seen integer not null)`
    }),
  },
})

const server = composeServer({ modules: [bg] })
const worker = createWorker(server, {
  infra: (env: { readonly url: string }) => PgFromHyperdrive({ connectionString: env.url }),
  buildId: () => 'test',
})
const db = useTestDatabase()

beforeAll(async () => {
  await Effect.runPromise(
    migrate(server.modules).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 2 })),
    ),
  )
})

/** One request; resolves once the response is back and every waitUntil promise settled. */
async function request(method: string, path: string) {
  const pending: Array<Promise<unknown>> = []
  const response = await worker.fetch(
    new Request(`https://host.test/api/bg${path}`, { method }),
    { url: db.url },
    { waitUntil: (p) => pending.push(p) },
  )
  const body = await response.text()
  await Promise.all(pending)
  return { status: response.status, body: body ? JSON.parse(body) : undefined }
}

const eventsAfter = async (scenario: (typeof scenarios)[number]) => {
  const before = (await request('GET', '/events')).body.length
  expect((await request('POST', `/run/${scenario}`)).status).toBe(204)
  return (await request('GET', '/events')).body.slice(before)
}

test('afterCommit work runs after the commit, on its own connection', async () => {
  // Seeing both notes means it ran after the second insert committed, outside the transaction.
  expect(await eventsAfter('commit')).toEqual([{ label: 'commit', seen: 2 }])
})

test('work queued in a nested transaction waits for the outermost commit', async () => {
  // The outer transaction inserts a note after the inner one finished; the work still sees it.
  expect(await eventsAfter('nested')).toEqual([{ label: 'nested', seen: 3 }])
})

test('a rollback discards queued work', async () => {
  expect(await eventsAfter('rollback')).toEqual([])
})

test('a rolled-back savepoint discards its work, the outer transaction keeps its own', async () => {
  expect(await eventsAfter('savepoint')).toEqual([{ label: 'kept', seen: 4 }])
})

test('outside a transaction the work runs after the response', async () => {
  // It sees the note the handler inserted after queueing it.
  expect(await eventsAfter('none')).toEqual([{ label: 'none', seen: 5 }])
})
