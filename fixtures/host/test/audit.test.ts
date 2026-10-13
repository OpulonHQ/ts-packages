import * as PgClient from '@effect/sql-pg/PgClient'
import {
  Audit,
  authorization,
  Authorization,
  composeServer,
  core,
  defineModule,
  migrate,
  Policy,
  withTransaction,
} from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Layer, Redacted, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { SqlClient } from 'effect/sql/SqlClient'
import { beforeAll, expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'

// A module that writes an entry and records an audit event for it in one transaction.
const scenarios = ['commit', 'rollback', 'undeclared', 'broken'] as const

const LedgerGroup = HttpApiGroup.make('ledger')
  .add(
    HttpApiEndpoint.post('write', '/write/:scenario', {
      params: { scenario: Schema.Literals(scenarios) },
    }).annotate(Policy, 'signedIn'),
  )
  .middleware(Authorization)

const write = (scenario: (typeof scenarios)[number]) =>
  withTransaction(
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const [row] = yield* sql<{ id: number }>`
        insert into ledger.entry (label) values (${scenario}) returning id`
      yield* Audit.record({
        action: scenario === 'undeclared' ? 'ledger.entry.vanished' : 'ledger.entry.created',
        // Postgres rejects NUL in text, so the 'broken' event fails to insert.
        subject: {
          type: 'entry',
          id: String(row!.id),
          label: scenario === 'broken' ? 'a\0b' : 'Rent',
        },
        changes: [{ field: 'memo', from: null, to: 'x'.repeat(600) }],
        context: { scenario },
      })
      if (scenario === 'rollback') yield* Effect.fail('roll back')
    }),
  ).pipe(scenario === 'rollback' ? Effect.ignore : Effect.orDie)

const ledger = defineModule({
  id: 'ledger',
  groups: [LedgerGroup],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'ledger', (h) =>
      Effect.succeed(h.handle('write', ({ params }) => write(params.scenario))),
    ),
  migrations: {
    '0001_create': Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`create table ledger.entry (id integer generated always as identity primary key,
        label text not null)`
    }),
  },
  auditActions: [{ key: 'ledger.entry.created', subject: 'entry' }],
})

const server = composeServer({
  modules: [core({ audit: { retentionDays: 30, ipRetentionDays: 7 } }), ledger],
})
const worker = createWorker(server, {
  infra: (env: { readonly url: string }) =>
    Layer.mergeAll(
      PgFromHyperdrive({ connectionString: env.url }),
      authorization(() =>
        Effect.succeed({
          id: 'u1',
          name: 'Jana Editor',
          email: 'jana@example.test',
          locale: null,
          permissions: [],
        }),
      ),
    ),
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

async function run(scenario: (typeof scenarios)[number]) {
  const pending: Array<Promise<unknown>> = []
  const response = await worker.fetch(
    new Request(`https://host.test/api/ledger/write/${scenario}`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'TestAgent/1' },
    }),
    { url: db.url },
    { waitUntil: (p) => pending.push(p) },
  )
  await response.text()
  await Promise.all(pending)
  return response.status
}

// No audit read API exists yet (the viewer ships after launch), so tests read the table.
const query = <R extends Record<string, unknown>>(text: string) => adminQuery<R>(db.url, text)
const entries = async () =>
  (await query<{ label: string }>('select label from ledger.entry')).map((r) => r.label)
const events = () =>
  query(`select actor_kind, actor_id, actor_name, action, subject_type, subject_label,
    changes, context, ip, user_agent from core.audit_event order by id`)

test('Audit.record writes the event in the caller transaction, with actor, request and truncated changes', async () => {
  expect(await run('commit')).toBe(204)
  expect(await entries()).toEqual(['commit'])
  expect(await events()).toEqual([
    {
      actor_kind: 'user',
      actor_id: 'u1',
      actor_name: 'Jana Editor',
      action: 'ledger.entry.created',
      subject_type: 'entry',
      subject_label: 'Rent',
      changes: [{ field: 'memo', from: null, to: `${'x'.repeat(500)}…` }],
      context: { scenario: 'commit' },
      ip: '203.0.113.7',
      user_agent: 'TestAgent/1',
    },
  ])
})

test('a rollback drops the event with the write', async () => {
  const before = (await events()).length
  expect(await run('rollback')).toBe(204)
  expect(await entries()).not.toContain('rollback')
  expect((await events()).length).toBe(before)
})

test('an audit insert failure fails the caller transaction', async () => {
  const before = (await events()).length
  expect(await run('broken')).toBe(500)
  expect(await entries()).not.toContain('broken')
  expect((await events()).length).toBe(before)
})

test('an undeclared action key fails the write', async () => {
  const before = (await events()).length
  expect(await run('undeclared')).toBe(500)
  expect(await entries()).not.toContain('undeclared')
  expect((await events()).length).toBe(before)
})

test('the daily core task purges old events and nulls IP/UA after the host-configured days', async () => {
  await query('delete from core.audit_event')
  await query(`insert into core.audit_event (occurred_at, actor_kind, action, ip, user_agent)
    values (now() - interval '31 days', 'system', 'ledger.entry.created', '1.1.1.1', 'UA'),
           (now() - interval '8 days', 'system', 'ledger.entry.created', '2.2.2.2', 'UA'),
           (now() - interval '6 days', 'system', 'ledger.entry.created', '3.3.3.3', 'UA')`)
  const expected = [
    { ip: null, user_agent: null },
    { ip: '3.3.3.3', user_agent: 'UA' },
  ]
  for (let i = 0; i < 2; i++) {
    // Midnight UTC: the 1d bucket is due. A second run changes nothing (idempotent).
    await worker.scheduled(
      { scheduledTime: Date.parse('2026-10-14T00:00:00Z'), cron: '*/5 * * * *' },
      { url: db.url },
    )
    expect(await query('select ip, user_agent from core.audit_event order by id')).toEqual(expected)
  }
})
