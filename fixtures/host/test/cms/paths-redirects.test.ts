import type { Redirect, RedirectImportResult } from '@opulonjs/cms/api'
import { beforeEach, expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

const host = useCmsHost()
// Tests share one database; each starts without redirects.
beforeEach(() => host.query('delete from cms.redirect'))

const list = async () =>
  (await host.call<{ rows: ReadonlyArray<Redirect> }>('GET', '/redirects')).body.rows
const rules = async () =>
  (await list())
    .map((r) => `${r.locale} ${r.from} -> ${r.to} ${r.status}${r.auto ? ' auto' : ''}`)
    .sort()
const create = (body: { locale?: string; from: string; to: string; status?: number }) =>
  host.call<Redirect>('POST', '/redirects', { body: { locale: 'en', status: 301, ...body } })
const importCsv = (csv: string) =>
  host.call<RedirectImportResult>('POST', '/redirects/import', { body: { csv } })

test('a path change on publish redirects the old path; chains collapse onto the newest path', async () => {
  const created = (await host.create(page({ en: '/team', it: '/squadra' }))).body
  await host.publish(created.id)
  expect(await rules()).toEqual([])

  // Only the en path changes: only en gets a redirect.
  await host.save(created.id, page({ en: '/people', it: '/squadra' }))
  expect(await rules()).toEqual([]) // drafts never redirect
  await host.publish(created.id)
  expect(await rules()).toEqual(['en /team -> /people 301 auto'])

  await host.save(created.id, page({ en: '/our-people', it: '/squadra' }))
  await host.publish(created.id)
  expect(await rules()).toEqual([
    'en /people -> /our-people 301 auto',
    'en /team -> /our-people 301 auto',
  ])

  // Moving back onto a redirected path: the page takes the path over, no loop is left behind.
  await host.save(created.id, page({ en: '/team', it: '/squadra' }))
  await host.publish(created.id)
  expect(await rules()).toEqual([
    'en /our-people -> /team 301 auto',
    'en /people -> /team 301 auto',
  ])

  const actions = await host.query<{ action: string; context: unknown }>(
    `select action, context from core.audit_event where action like 'cms.redirect.%' order by id`,
  )
  expect(actions.map((a) => a.action)).toEqual([
    'cms.redirect.created',
    'cms.redirect.created',
    'cms.redirect.deleted',
    'cms.redirect.created',
  ])
  expect(actions[0]?.context).toEqual({ documentId: created.id })
})

test('editors create, edit and delete redirects; each write is audited', async () => {
  const made = await create({ from: '/old-shop/', to: '/shop', status: 302 })
  expect(made.status).toBe(200)
  // Trailing slashes are dropped, so `/old-shop/` and `/old-shop` are one path.
  expect(made.body).toMatchObject({ locale: 'en', from: '/old-shop', to: '/shop', status: 302 })
  expect(made.body.auto).toBe(false)

  const edited = await host.call<Redirect>('PUT', `/redirects/${made.body.id}`, {
    body: { locale: 'it', from: '/old-shop', to: '/negozio', status: 301 },
  })
  expect(edited.body).toMatchObject({ id: made.body.id, locale: 'it', to: '/negozio', status: 301 })

  expect((await host.call('DELETE', `/redirects/${made.body.id}`)).status).toBe(204)
  expect(await list()).toEqual([])

  const events = await host.query<{ action: string; subject_label: string }>(
    `select action, subject_label from core.audit_event where subject_id = '${made.body.id}' order by id`,
  )
  expect(events).toEqual([
    { action: 'cms.redirect.created', subject_label: '/old-shop' },
    { action: 'cms.redirect.updated', subject_label: '/old-shop' },
    { action: 'cms.redirect.deleted', subject_label: '/old-shop' },
  ])
})

test('redirects never chain, loop, shadow a published page or repeat a path', async () => {
  const published = (await host.create(page({ en: '/contact' }))).body
  await host.publish(published.id)

  expect((await create({ from: '/a', to: '/b' })).status).toBe(200)
  // b -> c makes a -> b a chain: a is pointed at c directly.
  expect((await create({ from: '/b', to: '/c' })).status).toBe(200)
  expect(await rules()).toEqual(['en /a -> /c 301', 'en /b -> /c 301'])

  const loop = await create({ from: '/c', to: '/a' })
  expect(loop.status).toBe(409)
  expect(loop.body).toMatchObject({ reason: 'redirect_loop' })
  expect((await create({ from: '/x', to: '/x' })).body).toMatchObject({ reason: 'redirect_loop' })
  expect((await create({ from: '/a', to: '/d' })).body).toMatchObject({ reason: 'redirect_taken' })
  expect((await create({ from: '/contact', to: '/d' })).body).toMatchObject({
    reason: 'path_taken',
  })
  // The same path in another locale is a different path.
  expect((await create({ locale: 'it', from: '/contact', to: '/contatti' })).status).toBe(200)

  for (const bad of [
    { from: 'no-slash', to: '/x' },
    { from: '/x?y=1', to: '/z' },
    { from: '/x', to: 'https://elsewhere.test/' },
    { from: `/${'a'.repeat(1100)}`, to: '/z' },
    { from: '/x', to: '/z', locale: 'de' },
    { from: '/x', to: '/z', status: 307 },
  ])
    expect((await create(bad)).status).toBe(400)
})

test('CSV import validates each row and reports created, skipped and errors', async () => {
  await create({ from: '/existing', to: '/somewhere' })
  const published = (await host.create(page({ en: '/live' }))).body
  await host.publish(published.id)

  const { status, body } = await importCsv(
    [
      'from,to,status,locale',
      '/blog/hello-world/,/news/hello,301,en',
      '"/a,b",/news,302,',
      '/existing,/elsewhere,,',
      'not-a-path,/x,,',
      '/live,/x,,',
      '/blog/hello-world,/y,,',
      '"/quoted ""path""",/x,,',
      '/it-only,/solo,301,it',
      '/loop,/loop,,',
    ].join('\r\n'),
  )
  expect(status).toBe(200)
  expect(body).toEqual({
    created: 3,
    skipped: 2,
    errors: [
      { row: 5, message: expect.stringContaining('"not-a-path"') },
      { row: 6, message: expect.stringContaining('published page') },
      { row: 8, message: expect.stringContaining('"/quoted "path""') },
      { row: 10, message: expect.stringContaining('itself') },
    ],
  })
  expect(await rules()).toEqual([
    'en /a,b -> /news 302',
    'en /blog/hello-world -> /news/hello 301',
    'en /existing -> /somewhere 301',
    'it /it-only -> /solo 301',
  ])
  const events = await host.query<{ context: unknown }>(
    `select context from core.audit_event where action = 'cms.redirect.imported'`,
  )
  expect(events).toEqual([{ context: { created: 3, skipped: 2, errors: 4 } }])
})

test('CSV import refuses files without the from/to header or with too many rows', async () => {
  expect((await importCsv('source,target\n/a,/b')).status).toBe(400)
  const rows = Array.from({ length: 5001 }, (_, i) => `/r${i},/t`)
  expect((await importCsv(['from,to', ...rows].join('\n'))).status).toBe(400)
  expect(await list()).toEqual([])
})

test('redirects need their permissions', async () => {
  const viewer = ['cms.redirects.view']
  expect((await host.call('GET', '/redirects', { as: viewer })).status).toBe(200)
  expect(
    (
      await host.call('POST', '/redirects', {
        as: viewer,
        body: { locale: 'en', from: '/a', to: '/b', status: 301 },
      })
    ).status,
  ).toBe(403)
  expect(
    (await host.call('POST', '/redirects/import', { as: viewer, body: { csv: '' } })).status,
  ).toBe(403)
  expect((await host.call('GET', '/redirects', { as: ['cms.pages.view'] })).status).toBe(403)
})
