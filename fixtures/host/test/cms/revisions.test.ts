import type { Item, Menu, Page, SiteSettings } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

const host = useCmsHost()
type Document = Page | Item | Menu | SiteSettings
type Summary = { id: string; createdAt: string; author: { id: string | null; name: string } }
type Revision = Summary & { document: Document['draft'] }

const cases = [
  {
    kind: 'page',
    permission: 'cms.pages',
    create: '/pages',
    path: (d?: Document) => `/pages/${d && 'id' in d ? d.id : ''}`,
    first: page({ en: '/revision-page' }),
    second: page({ en: '/revision-page-new' }),
  },
  {
    kind: 'item',
    permission: 'cms.collections',
    create: '/collections/posts/items',
    path: (d?: Document) => `/items/${d && 'id' in d ? d.id : ''}`,
    first: { locales: {}, data: { title: { en: 'First post' } } },
    second: { locales: {}, data: { title: { en: 'Second post' } } },
  },
  {
    kind: 'settings',
    permission: 'cms.site',
    path: () => '/settings',
    first: { data: { siteName: { en: 'First site' } } },
    second: { data: { siteName: { en: 'Second site' } } },
  },
  {
    kind: 'menu',
    permission: 'cms.site',
    path: () => '/menus/main',
    first: {
      items: [
        {
          id: crypto.randomUUID(),
          label: { en: 'First link' },
          link: { type: 'url', url: '/first' },
          children: [],
        },
      ],
    },
    second: { items: [] },
  },
]

test.each(cases)(
  '$kind revisions list author/date, view, restore only the draft, and audit',
  async (c) => {
    const path = c.create
      ? c.path((await host.call<Document>('POST', c.create, { body: c.first })).body)
      : c.path()
    if (!c.create) expect((await host.saveDraft(path, c.first)).status).toBe(200)
    expect(
      (await host.call<{ rows: Summary[]; total: number }>('GET', `${path}/revisions`)).body,
    ).toEqual({ rows: [], total: 0 })
    const first = (await host.publishDraft<Document>(path)).body
    await host.saveDraft(path, c.second)
    const second = (await host.publishDraft<Document>(path)).body
    const list = await host.call<{ rows: Summary[]; total: number }>('GET', `${path}/revisions`)
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('private, no-store')
    expect(list.body.total).toBe(2)
    expect(list.body.rows.map((r) => r.id)).toEqual([
      second.publishedRevisionId,
      first.publishedRevisionId,
    ])
    expect(list.body.rows[0]).toMatchObject({
      createdAt: expect.any(String),
      author: { id: expect.any(String), name: 'Eda Editor' },
    })
    expect(list.body.rows[0]).not.toHaveProperty('document')
    const view = await host.call<Revision>('GET', `${path}/revisions/${first.publishedRevisionId}`)
    expect(view.body.document).toEqual(first.draft)
    const purges = host.purged.length
    const restore = await host.call<Document>(
      'POST',
      `${path}/revisions/${first.publishedRevisionId}/restore?version=${second.version}`,
    )
    expect(restore.status).toBe(200)
    expect(restore.body).toMatchObject({
      status: 'changed',
      draft: first.draft,
      published: second.published,
      publishedAt: second.publishedAt,
      publishedRevisionId: second.publishedRevisionId,
    })
    expect(host.purged.length).toBe(purges)
    expect((await host.call<{ total: number }>('GET', `${path}/revisions`)).body.total).toBe(2)
    expect(
      await host.query(
        `select context from core.audit_event where action = 'cms.${c.kind}.restored'`,
      ),
    ).toContainEqual({ context: { revisionId: first.publishedRevisionId } })
    const restoreAgain = `${path}/revisions/${first.publishedRevisionId}/restore?version=${restore.body.version}`
    for (const as of [[], [`${c.permission}.view`, `${c.permission}.edit`]]) {
      expect((await host.call('POST', restoreAgain, { as })).status).toBe(403)
    }
    expect((await host.call('GET', `${path}/revisions`, { as: [] })).status).toBe(403)
    expect(
      (await host.call('GET', `${path}/revisions/${first.publishedRevisionId}`, { as: [] })).status,
    ).toBe(403)
    expect((await host.call('GET', `${path}/revisions`, { as: null })).status).toBe(401)
    expect(
      (
        await host.call('POST', restoreAgain, {
          as: [`${c.permission}.publish`],
        })
      ).status,
    ).toBe(200)
    const published = await host.publishDraft<Document>(path)
    expect(published.body.published).toEqual(first.draft)
  },
)

test('a revision must belong to the requested document; missing and malformed ids return 404', async () => {
  const a = (await host.create(page({ en: '/revision-a' }))).body
  const b = (await host.create(page({ en: '/revision-b' }))).body
  const published = (await host.publish(a.id)).body
  for (const revisionId of [published.publishedRevisionId, crypto.randomUUID(), 'invalid']) {
    expect((await host.call('GET', `/pages/${b.id}/revisions/${revisionId}`)).status).toBe(404)
    expect(
      (
        await host.call(
          'POST',
          `/pages/${b.id}/revisions/${revisionId}/restore?version=${b.version}`,
        )
      ).status,
    ).toBe(404)
  }
  expect((await host.call('GET', '/menus/unknown/revisions')).status).toBe(404)
  expect(
    (await host.call('GET', `/settings/revisions/${published.publishedRevisionId}`)).status,
  ).toBe(404)
})

test('restore refuses an old path now occupied by another document without changing the draft or auditing', async () => {
  const a = (await host.create(page({ en: '/revision-reused' }))).body
  const old = (await host.publish(a.id)).body
  const moved = (await host.save(a.id, page({ en: '/revision-moved' }))).body
  await host.publish(a.id)
  await host.create(page({ en: '/revision-reused' }))
  const refused = await host.call(
    'POST',
    `/pages/${a.id}/revisions/${old.publishedRevisionId}/restore?version=${moved.version}`,
  )
  expect(refused.status).toBe(409)
  expect(refused.body).toMatchObject({ reason: 'path_taken' })
  expect((await host.call<Page>('GET', `/pages/${a.id}`)).body.draft.locales.en?.path).toBe(
    '/revision-moved',
  )
  expect(
    await host.query(
      `select action from core.audit_event where subject_id = '${a.id}' and action = 'cms.page.restored'`,
    ),
  ).toEqual([])
})

test('revision lists paginate and validate page bounds', async () => {
  const created = (await host.create(page({ en: '/revision-pagination' }))).body
  for (let i = 0; i < 26; i++) await host.publish(created.id)
  const first = await host.call<{ rows: Summary[]; total: number }>(
    'GET',
    `/pages/${created.id}/revisions`,
  )
  const second = await host.call<{ rows: Summary[]; total: number }>(
    'GET',
    `/pages/${created.id}/revisions?page=2`,
  )
  expect(first.body.rows).toHaveLength(25)
  expect(first.body.total).toBe(26)
  expect(second.body.rows).toHaveLength(1)
  expect(first.body.rows.map((r) => r.id)).not.toContain(second.body.rows[0]?.id)
  expect((await host.call('GET', `/pages/${created.id}/revisions?page=0`)).status).toBe(400)
})
