import * as PgClient from '@effect/sql-pg/PgClient'
import {
  Audit,
  Composed,
  CurrentActor,
  composeServer,
  core,
  diffFields,
  systemActor,
} from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Mailer } from '@opulonjs/emails/server'
import { Effect, Layer, Redacted } from 'effect'
import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { server } from '../server/opulon.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

test('audit masks expired request metadata even when the purge has not run', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event
    (occurred_at, actor_kind, action, subject_id, ip, user_agent) values
    (now() - interval '91 days', 'system', 'users.locale_changed', 'privacy-window', 'old-ip', 'old-agent'),
    (now() - interval '8 days', 'system', 'users.locale_changed', 'privacy-window', 'recent-ip', 'recent-agent'),
    (now() - interval '1 day', 'system', 'users.locale_changed', 'privacy-window', 'fresh-ip', 'fresh-agent')`,
  )
  const response = await host.request('GET', '/audit?subjectId=privacy-window', { cookie })
  expect(response.status).toBe(200)
  expect(response.body).toMatchObject({
    rows: [
      { ip: 'fresh-ip', userAgent: 'fresh-agent' },
      { ip: 'recent-ip', userAgent: 'recent-agent' },
      { ip: null, userAgent: null },
    ],
  })
  const configured = createWorker(
    composeServer({
      modules: [
        core({ audit: { ipRetentionDays: 7 } }),
        ...server.modules.filter((module) => module.id === 'emails' || module.id === 'users'),
      ],
    }),
    {
      infra: (env: ReturnType<typeof host.env>) =>
        Layer.mergeAll(PgFromHyperdrive(env.HYPERDRIVE), Mailer.log),
      buildId: () => 'privacy-window',
    },
  )
  const custom = await configured.fetch(
    new Request('https://host.test/api/audit?subjectId=privacy-window', {
      headers: { cookie, origin: 'https://host.test' },
    }),
    host.env(),
    { waitUntil: () => {} },
  )
  expect(custom.status).toBe(200)
  expect(await custom.json()).toMatchObject({
    rows: [
      { ip: 'fresh-ip', userAgent: 'fresh-agent' },
      { ip: null, userAgent: null },
      { ip: null, userAgent: null },
    ],
  })
  expect(
    await sqlQuery(db.url, 'select ip from core.audit_event where subject_id = $1 order by id', [
      'privacy-window',
    ]),
  ).toEqual([{ ip: 'old-ip' }, { ip: 'recent-ip' }, { ip: 'fresh-ip' }])
})

test('audit rejects requests beyond the maximum paging offset', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  for (const query of ['page=102&perPage=100', 'page=10002&perPage=1', 'page=402']) {
    expect((await host.request('GET', `/audit?${query}`, { cookie })).status, query).toBe(400)
  }
  expect((await host.request('GET', '/audit?page=101&perPage=100', { cookie })).status).toBe(200)
})

test('audit reads added and removed fields serialized by the existing writer', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  const absent: { memo?: string } = {}
  const present: { memo?: string } = { memo: 'added' }
  await Effect.runPromise(
    Effect.gen(function* () {
      for (const changes of [
        diffFields(absent, present, ['memo']),
        diffFields(present, absent, ['memo']),
      ]) {
        yield* Audit.record({
          action: 'users.locale_changed',
          subject: { type: 'user', id: 'historical-changes', label: 'Snapshot user' },
          changes,
        })
      }
    }).pipe(
      Effect.provideService(Composed, {
        modules: ['core', 'users'],
        permissions: ['core.audit.view'],
        auditActions: new Set(['users.locale_changed']),
        contributions: [],
      }),
      Effect.provideService(CurrentActor, systemActor('Importer')),
      Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 2 })),
    ),
  )
  expect(
    await sqlQuery(
      db.url,
      'select changes from core.audit_event where subject_id = $1 order by id',
      ['historical-changes'],
    ),
  ).toEqual([
    { changes: [{ field: 'memo', to: 'added' }] },
    { changes: [{ field: 'memo', from: 'added' }] },
  ])
  const result = await host.request('GET', '/audit?subjectId=historical-changes', { cookie })
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({
    total: 2,
    rows: [
      { changes: [{ field: 'memo', from: 'added', to: null }] },
      { changes: [{ field: 'memo', from: null, to: 'added' }] },
    ],
  })
})

test('audit requires a session and core.audit.view', async () => {
  expect((await host.request('GET', '/audit')).status).toBe(401)
  const user = await seedUser(db.url)
  const cookie = await host.signIn(user.email, user.password)
  expect((await host.request('GET', '/audit', { cookie })).status).toBe(403)
})

test('audit pages immutable snapshots newest first with filters and a true total beyond the end', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event
    (occurred_at, actor_kind, actor_id, actor_name, action, subject_type, subject_id,
     subject_label, changes, ip, user_agent) values
    ('2026-01-01T12:00:00Z', 'system', null, 'Importer', 'demo.created', 'note', 'a',
      'Old title', null, null, null),
    ('2026-01-02T12:00:00Z', 'user', 'deleted-user', 'Former editor', 'users.locale_changed', 'user', 'b',
      'Snapshot name', '[{"field":"locale","from":"en","to":"sk"}]', '10.1.2.3', 'Historic UA'),
    ('2026-01-02T12:00:00Z', 'anonymous', null, null, 'demo.changed', 'note', 'a',
      'New title', null, null, null)`,
  )
  const get = (query: string) => host.request('GET', `/audit?${query}`, { cookie })
  const range = 'start=2026-01-01T00:00:00Z&end=2026-01-03T00:00:00Z'
  const first = await get(`${range}&page=1&perPage=2`)
  expect(first.status).toBe(200)
  expect(first.body).toMatchObject({
    total: 3,
    rows: [
      {
        action: 'demo.changed',
        actor: { kind: 'anonymous', id: null, name: null },
        ip: null,
        userAgent: null,
      },
      {
        action: 'users.locale_changed',
        actor: { id: 'deleted-user', name: 'Former editor' },
        subject: { type: 'user', id: 'b', label: 'Snapshot name' },
        changes: [{ field: 'locale', from: 'en', to: 'sk' }],
        ip: null,
        userAgent: null,
      },
    ],
  })
  expect((await get(`${range}&page=2&perPage=2`)).body).toMatchObject({
    total: 3,
    rows: [{ action: 'demo.created' }],
  })
  expect((await get(`${range}&page=99&perPage=2`)).body).toEqual({ total: 3, rows: [] })
  for (const query of [
    'actor=Former',
    'actor=deleted-user',
    'actor=user',
    'module=users',
    'action=users.locale_changed',
    'subjectType=user',
    'subjectId=b',
    'subjectLabel=Snapshot',
    'module=users&actor=Former&subjectType=user&subjectId=b',
  ]) {
    expect((await get(`${range}&${query}`)).body).toMatchObject({
      total: 1,
      rows: [{ action: 'users.locale_changed' }],
    })
  }
  expect((await get(`${range}&module=user`)).body).toEqual({ total: 0, rows: [] })
  expect((await get('start=2026-01-02T12:00:00Z&end=2026-01-03T00:00:00Z')).body).toMatchObject({
    total: 2,
  })
  expect((await get('start=2026-01-01T12:00:00Z&end=2026-01-02T12:00:00Z')).body).toMatchObject({
    total: 1,
  })
  expect((await get(`${range}&actor=%25`)).body).toEqual({ total: 0, rows: [] })
  expect((await get('start=2026-01-02T12:00:00Z&end=2026-01-02T12:00:00.500Z')).body).toMatchObject(
    { total: 2 },
  )
})

test('audit rejects invalid paging, dates and reversed ranges at the HTTP boundary', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1000001',
    'perPage=0',
    'perPage=101',
    'start=bad',
    'end=2026-02-30T00:00:00Z',
    'start=2026-01-03T00:00:00Z&end=2026-01-02T00:00:00Z',
  ]) {
    expect((await host.request('GET', `/audit?${query}`, { cookie })).status, query).toBe(400)
  }
})
