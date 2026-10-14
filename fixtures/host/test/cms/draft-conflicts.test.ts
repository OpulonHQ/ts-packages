import type { Item, Menu, Page, SiteSettings } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

const host = useCmsHost()
type Document = Page | Item | Menu | SiteSettings

const cases = [
  {
    kind: 'page',
    create: '/pages',
    path: (d?: Document) => `/pages/${d && 'id' in d ? d.id : ''}`,
    get first() {
      return page({ en: `/conflict-${crypto.randomUUID()}` })
    },
    get second() {
      return page({ en: `/conflict-${crypto.randomUUID()}` })
    },
    get third() {
      return page({ en: `/conflict-${crypto.randomUUID()}` })
    },
  },
  {
    kind: 'item',
    create: '/collections/posts/items',
    path: (d?: Document) => `/items/${d && 'id' in d ? d.id : ''}`,
    first: { locales: {}, data: { title: { en: 'First post' } } },
    second: { locales: {}, data: { title: { en: 'Second post' } } },
    third: { locales: {}, data: { title: { en: 'Third post' } } },
  },
  {
    kind: 'settings',
    path: () => '/settings',
    first: { data: { siteName: { en: 'First site' } } },
    second: { data: { siteName: { en: 'Second site' } } },
    third: { data: { siteName: { en: 'Third site' } } },
  },
  {
    kind: 'menu',
    path: () => '/menus/main',
    first: { items: [] },
    second: {
      items: [
        {
          id: crypto.randomUUID(),
          label: { en: 'Second link' },
          link: { type: 'url', url: '/second' },
          children: [],
        },
      ],
    },
    third: {
      items: [
        {
          id: crypto.randomUUID(),
          label: { en: 'Third link' },
          link: { type: 'url', url: '/third' },
          children: [],
        },
      ],
    },
  },
]

const load = async (c: (typeof cases)[number]) => {
  const created = c.create
    ? (await host.call<Document>('POST', c.create, { body: c.first })).body
    : undefined
  const path = c.path(created)
  const loaded = created ?? (await host.call<Document>('GET', path)).body
  return { path, loaded }
}
const save = (path: string, version: number, body: unknown) =>
  host.call<Document>('PUT', `${path}/draft?version=${version}`, { body })
const publish = (path: string, version: number) =>
  host.call<Document>('POST', `${path}/publish?version=${version}`)

test.each(cases)(
  '$kind: a save from a stale draft version is refused and changes nothing',
  async (c) => {
    const { path, loaded } = await load(c)
    const fresh = await save(path, loaded.version, c.second)
    expect(fresh.status).toBe(200)
    expect(fresh.body.version).toBe(loaded.version + 1)

    const stale = await save(path, loaded.version, c.third)
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ _tag: 'CmsConflict', reason: 'draft_changed' })
    expect((await host.call<Document>('GET', path)).body).toEqual(fresh.body)
  },
)

test.each(cases)(
  "$kind: a restore followed by a stale editor's save-then-publish is refused",
  async (c) => {
    const { path, loaded } = await load(c)
    const firstDraft = await save(path, loaded.version, c.first)
    const first = (await publish(path, firstDraft.body.version)).body
    const secondDraft = await save(path, first.version, c.second)
    const second = (await publish(path, secondDraft.body.version)).body

    const restored = await host.call<Document>(
      'POST',
      `${path}/revisions/${first.publishedRevisionId}/restore?version=${second.version}`,
    )
    expect(restored.status).toBe(200)
    expect(restored.body.version).toBeGreaterThan(second.version)
    const purges = host.purged.length

    expect((await publish(path, second.version)).status).toBe(409)
    const staleSave = await save(path, second.version, c.third)
    expect(staleSave.status).toBe(409)
    expect(staleSave.body).toMatchObject({ _tag: 'CmsConflict', reason: 'draft_changed' })

    const after = (await host.call<Document>('GET', path)).body
    expect(after).toEqual(restored.body)
    expect(after.published).toEqual(second.published)
    expect(after.draft).toEqual(first.draft)
    expect(host.purged.length).toBe(purges)
    expect((await host.call<{ total: number }>('GET', `${path}/revisions`)).body.total).toBe(2)

    const reloaded = await publish(path, restored.body.version)
    expect(reloaded.status).toBe(200)
    expect(reloaded.body.published).toEqual(first.draft)
  },
)

test.each(cases)('$kind: of two simultaneous saves from one version, one wins', async (c) => {
  const { path, loaded } = await load(c)
  const results = await Promise.all([
    save(path, loaded.version, c.second),
    save(path, loaded.version, c.third),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  const winner = results.find((r) => r.status === 200)!.body
  expect(winner.version).toBe(loaded.version + 1)
  expect((await host.call<Document>('GET', path)).body).toEqual(winner)
})

test.each(cases)(
  '$kind: a restore from a stale draft version is refused and changes nothing',
  async (c) => {
    const { path, loaded } = await load(c)
    const saved = await save(path, loaded.version, c.first)
    const first = (await publish(path, saved.body.version)).body
    const theirs = (await save(path, first.version, c.second)).body

    const stale = await host.call(
      'POST',
      `${path}/revisions/${first.publishedRevisionId}/restore?version=${first.version}`,
    )
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ _tag: 'CmsConflict', reason: 'draft_changed' })
    expect((await host.call<Document>('GET', path)).body).toEqual(theirs)
  },
)

test('saving, publishing or restoring without the loaded draft version is a bad request', async () => {
  const created = (await host.create(page({ en: '/conflict-unversioned' }))).body
  const published = (await host.publish(created.id)).body
  expect(
    (
      await host.call('PUT', `/pages/${created.id}/draft`, {
        body: page({ en: '/conflict-unversioned' }),
      })
    ).status,
  ).toBe(400)
  expect((await host.call('POST', `/pages/${created.id}/publish`)).status).toBe(400)
  expect(
    (
      await host.call(
        'POST',
        `/pages/${created.id}/revisions/${published.publishedRevisionId}/restore`,
      )
    ).status,
  ).toBe(400)
  expect((await host.call<Page>('GET', `/pages/${created.id}`)).body).toEqual(published)
})
