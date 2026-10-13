import type { Item, ItemDocument, ItemPreview } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { locale, page, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const imageId = '0b5e8f9e-2d4f-4c8e-9a51-7f0e3c1d2a4b'

const item = (data: Record<string, unknown>, paths: { en?: string; it?: string } = {}) =>
  ({
    locales: Object.fromEntries(
      Object.entries(paths).map(([code, path]) => [code, locale(path ?? '')]),
    ),
    data,
  }) satisfies ItemDocument
const create = (collection: string, draft: ItemDocument) =>
  host.call<Item>('POST', `/collections/${collection}/items`, { body: draft })
const publish = (id: string) => host.call<Item>('POST', `/items/${id}/publish`)

test('an item is validated against its collection, published with a revision, audited and purged', async () => {
  const category = (await create('categories', item({ name: { en: 'News' } }))).body
  const created = await create(
    'posts',
    item(
      {
        title: { en: 'Hello', it: 'Ciao' },
        body: { en: '<p>Hi<script>x</script></p>' },
        cover: imageId,
        categories: [category.id],
        unknown: 'dropped',
      },
      { en: '/blog/hello', it: '/blog/ciao' },
    ),
  )
  expect(created.status).toBe(200)
  expect(created.body).toMatchObject({
    collection: 'posts',
    title: 'Hello',
    path: '/blog/hello',
    status: 'draft',
  })
  expect(created.body.draft.data).toEqual({
    title: { en: 'Hello', it: 'Ciao' },
    body: { en: '<p>Hi</p>' },
    cover: imageId,
    categories: [category.id],
  })

  const purges = host.purged.length
  const { body } = await publish(created.body.id)
  expect(body).toMatchObject({ status: 'published', published: body.draft })
  expect(host.purged.slice(purges)).toEqual([
    [`cms:item:${created.body.id}`, 'cms:collection:posts', 'cms:routes'],
  ])
  const [revision] = await host.query(
    `select reason, document from cms.revision where id = '${body.publishedRevisionId}'`,
  )
  expect(revision).toEqual({ reason: 'publish', document: body.draft })
  expect(
    await host.query(`select action, context from core.audit_event
      where subject_id = '${created.body.id}'`),
  ).toEqual([{ action: 'cms.item.published', context: { revisionId: body.publishedRevisionId } }])
  // Routed items take their published paths, in the same URL space as pages.
  expect(
    await host.query(
      `select locale, path from cms.path where document_id = '${created.body.id}' order by locale`,
    ),
  ).toEqual([
    { locale: 'en', path: '/blog/hello' },
    { locale: 'it', path: '/blog/ciao' },
  ])
})

test('items and pages share one URL space', async () => {
  expect((await host.create(page({ en: '/shared' }))).status).toBe(200)
  const clash = await create('posts', item({ title: { en: 'X' } }, { en: '/shared' }))
  expect(clash.status).toBe(409)
  expect(clash.body).toMatchObject({ reason: 'path_taken' })

  const post = (await create('posts', item({ title: { en: 'Y' } }, { en: '/blog/y' }))).body
  expect((await host.create(page({ en: '/blog/y' }))).status).toBe(409)
  expect(post.path).toBe('/blog/y')
})

test.each([
  [
    'a path in a collection that is not routed',
    'categories',
    item({ name: { en: 'A' } }, { en: '/a' }),
    'no own path',
  ],
  [
    'a field failing its schema',
    'testimonials',
    item({ quote: { en: 'Q' }, author: 7 }),
    'Testimonials',
  ],
  ['a reference that is not an item id', 'posts', item({ categories: ['news'] }), 'Posts'],
])('%s is refused', async (_, collection, draft, message) => {
  const { status, body } = await create(collection, draft)
  expect(status).toBe(400)
  expect(body).toMatchObject({ _tag: 'CmsInvalid', message: expect.stringContaining(message) })
})

test('publishing needs the required fields; an unknown collection is not found', async () => {
  const draft = (await create('testimonials', item({ author: 'Ann' }))).body
  expect(draft.title).toBe('Ann')
  const refused = await publish(draft.id)
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ message: 'Testimonials: "Quote" is required in en.' })
  expect((await create('widgets', item({}))).status).toBe(404)
  expect((await host.call('GET', '/collections/widgets/items')).status).toBe(404)
})

test('items are listed per collection, previewed per locale, unpublished and deleted with an audit trail', async () => {
  const a = (await create('categories', item({ name: { en: 'Sport', it: 'Sport' } }))).body
  await create('testimonials', item({ quote: { en: 'Great' }, author: 'Bo' }))
  const list = await host.call<{ rows: Array<{ id: string; title: string }> }>(
    'GET',
    '/collections/categories/items',
  )
  // Only this collection's items (the file's database also holds other tests' items).
  const titles = list.body.rows.map((r) => r.title)
  expect(titles).toContain('Sport')
  expect(titles).not.toContain('Bo')

  const preview = await host.call<ItemPreview>('GET', `/items/${a.id}/preview?locale=it`)
  expect(preview.headers.get('cache-control')).toBe('private, no-store')
  expect(preview.body).toMatchObject({ locale: 'it', data: { name: 'Sport' } })

  await publish(a.id)
  const purges = host.purged.length
  const unpublished = await host.call<Item>('POST', `/items/${a.id}/unpublish`)
  expect(unpublished.body).toMatchObject({ status: 'draft', published: null })
  expect((await host.call('DELETE', `/items/${a.id}`)).status).toBe(204)
  expect((await host.call('GET', `/items/${a.id}`)).status).toBe(404)
  expect(host.purged.slice(purges)).toEqual([
    [`cms:item:${a.id}`, 'cms:collection:categories', 'cms:routes'],
  ])
  const actions = await host.query<{ action: string }>(
    `select action from core.audit_event where subject_id = '${a.id}' order by id`,
  )
  expect(actions.map((x) => x.action)).toEqual([
    'cms.item.published',
    'cms.item.unpublished',
    'cms.item.deleted',
  ])
})

test('collections need the collections permissions', async () => {
  const pagesOnly = ['cms.pages.view', 'cms.pages.edit', 'cms.pages.publish']
  expect((await host.call('GET', '/collections/posts/items', { as: pagesOnly })).status).toBe(403)
  const viewer = ['cms.collections.view']
  expect((await host.call('GET', '/collections/posts/items', { as: viewer })).status).toBe(200)
  expect(
    (
      await host.call('POST', '/collections/categories/items', {
        as: viewer,
        body: item({ name: { en: 'X' } }),
      })
    ).status,
  ).toBe(403)
})

test('a routed item whose published path changes leaves a redirect behind', async () => {
  const post = (await create('posts', item({ title: { en: 'Move' } }, { en: '/blog/move' }))).body
  await publish(post.id)
  await host.call('PUT', `/items/${post.id}/draft`, {
    body: item({ title: { en: 'Move' } }, { en: '/blog/moved' }),
  })
  await publish(post.id)
  const { body } = await host.call<{ rows: Array<{ from: string; to: string; auto: boolean }> }>(
    'GET',
    '/redirects',
  )
  expect(body.rows).toContainEqual(
    expect.objectContaining({ from: '/blog/move', to: '/blog/moved', auto: true }),
  )
})
