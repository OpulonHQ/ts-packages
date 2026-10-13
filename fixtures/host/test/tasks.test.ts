import * as PgClient from '@effect/sql-pg/PgClient'
import { composeServer, CurrentActor, defineModule, migrate } from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Layer, Redacted } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'

// Every task records its name and the actor it ran as; `slow` takes a while before recording.
const record = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const actor = yield* CurrentActor
    yield* sql`insert into tk.run (task, actor) values (${name}, ${actor.kind})`
  }).pipe(Effect.orDie)

const tk = defineModule({
  id: 'tk',
  groups: [],
  handlers: () => Layer.empty,
  migrations: {
    '0001_create': Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`create table tk.run (id integer generated always as identity primary key,
        task text not null, actor text not null)`
    }),
  },
  tasks: [
    { name: 'slow', every: '5m', run: Effect.andThen(Effect.sleep('30 millis'), record('slow')) },
    { name: 'hourly', every: '1h', run: record('hourly') },
    { name: 'daily', every: '1d', run: record('daily') },
  ],
})

const failing = defineModule({
  id: 'failing',
  groups: [],
  handlers: () => Layer.empty,
  tasks: [{ name: 'broken', every: '5m', run: Effect.fail(new Error('task exploded')) }],
})

const after = defineModule({
  id: 'after',
  groups: [],
  handlers: () => Layer.empty,
  dependsOn: ['tk'],
  tasks: [{ name: 'fast', every: '5m', run: record('fast') }],
})

const db = useTestDatabase()
const infra = (env: { readonly url: string }) => PgFromHyperdrive({ connectionString: env.url })

beforeAll(async () => {
  await Effect.runPromise(
    migrate(composeServer({ modules: [tk] }).modules).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 2 })),
    ),
  )
})

beforeEach(async () => {
  await sql('delete from tk.run')
})

async function sql(statement: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* SqlClient
      return yield* client.unsafe<{ task: string; actor: string }>(statement)
    }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 1 }))),
  )
}

const runs = () => sql('select task, actor from tk.run order by id')

const tick = (modules: Parameters<typeof composeServer>[0]['modules'], iso: string) =>
  createWorker(composeServer({ modules }), { infra, buildId: () => 'test' }).scheduled(
    { scheduledTime: Date.parse(iso), cron: '*/5 * * * *' },
    { url: db.url },
  )

test('a */5 tick runs only the tasks whose UTC bucket starts at the scheduled time', async () => {
  await tick([tk], '2026-10-13T10:05:00Z')
  expect((await runs()).map((r) => r.task)).toEqual(['slow'])
})

test('the top of the hour adds hourly tasks, UTC midnight adds daily tasks', async () => {
  await tick([tk], '2026-10-13T10:00:00Z')
  await tick([tk], '2026-10-14T00:00:00Z')
  expect((await runs()).map((r) => r.task)).toEqual(['slow', 'hourly', 'slow', 'hourly', 'daily'])
})

test('a missed tick is skipped, not caught up', async () => {
  // 10:00 never fired; 10:05 does not run the hourly task late.
  await tick([tk], '2026-10-13T10:05:00Z')
  expect((await runs()).map((r) => r.task)).not.toContain('hourly')
})

test('due tasks run one after another as the system actor', async () => {
  await tick([tk, after], '2026-10-13T10:05:00Z')
  expect(await runs()).toEqual([
    { task: 'slow', actor: 'system' },
    { task: 'fast', actor: 'system' },
  ])
})

test('a failing task is logged, the rest still run, and the invocation fails at the end', async () => {
  const logs: Array<unknown> = []
  const capture = (...args: Array<unknown>) => void logs.push(...args)
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')].map((spy) =>
    spy.mockImplementation(capture),
  )
  await expect(tick([tk, failing, after], '2026-10-13T10:05:00Z')).rejects.toThrow(
    /failing\.broken/,
  )
  expect((await runs()).map((r) => r.task)).toEqual(['slow', 'fast'])
  spies.forEach((spy) => spy.mockRestore())
  expect(logs.map(String).join(' ')).toMatch(/failing\.broken[\s\S]*task exploded/)
})
