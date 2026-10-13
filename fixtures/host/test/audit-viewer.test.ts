import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

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
        ip: '10.1.2.3',
        userAgent: 'Historic UA',
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
