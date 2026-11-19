import type { Item, ItemDocument, ItemPage, PageSummary } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { runOpulon } from '../../../../test/opulon.ts'
import { locale, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

const seo = (title: string) => ({ title, description: '', image: null, noindex: false })
const unavailable = { ...locale(''), available: false }
const createItem = (collection: string, draft: ItemDocument) =>
  host.call<Item>('POST', `/collections/${collection}/items`, { body: draft })
const listItems = (collection: string, query = '') =>
  host.call<ItemPage>('GET', `/collections/${collection}/items?${query}`)
const listPages = async () =>
  (await host.call<{ rows: Array<PageSummary> }>('GET', '/pages')).body.rows
const read = <Body>(path: string) => host.call<Body>('GET', path, { as: null })

test('a page in Italian only lists with its Italian title, Italian path and its locales', async () => {
  const italian = await host.create({
    locales: { it: locale('/contatti-sede', { seo: seo('Contatti') }) },
    sections: [],
  })
  expect(italian.body).toMatchObject({ title: 'Contatti', path: '/it/contatti-sede' })
  const both = await host.create({
    locales: {
      en: locale('/visit', { seo: seo('Visit us') }),
      it: locale('/visita', { seo: seo('Visitaci') }),
    },
    sections: [],
  })
  const none = await host.create({ locales: {}, sections: [] })

  const rows = await listPages()
  expect(rows.find((row) => row.id === italian.body.id)).toMatchObject({
    title: 'Contatti',
    path: '/it/contatti-sede',
    locales: ['it'],
  })
  expect(rows.find((row) => row.id === both.body.id)).toMatchObject({
    title: 'Visit us',
    path: '/visit',
    locales: ['en', 'it'],
  })
  expect(rows.find((row) => row.id === none.body.id)).toMatchObject({
    title: 'Untitled',
    path: '',
    locales: [],
  })
})

test('an item in Italian only lists with its Italian title and path, searchable and sortable', async () => {
  const italian = await createItem('posts', {
    locales: { it: locale('/blog/solo-italiano') },
    data: { title: { it: 'Solo italiano' } },
  })
  expect(italian.body).toMatchObject({
    title: 'Solo italiano',
    path: '/it/blog/solo-italiano',
    locales: ['it'],
  })
  const english = await createItem('posts', {
    locales: { en: locale('/blog/zz-english') },
    data: { title: { en: 'Zz English', it: 'Zz inglese' } },
  })

  const found = await listItems('posts', 'search=solo')
  expect(found.body.rows).toMatchObject([
    {
      id: italian.body.id,
      title: 'Solo italiano',
      path: '/it/blog/solo-italiano',
      locales: ['it'],
    },
  ])
  expect((await listItems('posts', 'search=it/blog/solo')).body.total).toBe(1)
  const byPath = await listItems('posts', 'sort=path&direction=asc')
  expect(byPath.body.rows.map((row) => row.path)).toEqual([
    '/blog/zz-english',
    '/it/blog/solo-italiano',
  ])
  expect(byPath.body.rows[0]).toMatchObject({ id: english.body.id, locales: ['en'] })
  const byTitle = await listItems('posts', 'sort=title&direction=asc&search=o')
  expect(byTitle.body.rows.map((row) => row.title)).toEqual(['Solo italiano', 'Zz English'])
})

test('availableIn lists the items available in a content locale, a missing unrouted locale counting as available', async () => {
  const everywhere = await createItem('categories', { locales: {}, data: { name: { en: 'All' } } })
  expect(everywhere.body.locales).toEqual(['en', 'it'])
  const englishOnly = await createItem('categories', {
    locales: { it: unavailable },
    data: { name: { en: 'English only' } },
  })
  expect(englishOnly.body.locales).toEqual(['en'])
  const italianOnly = await createItem('categories', {
    locales: { en: unavailable },
    data: { name: { en: 'Solo IT', it: 'Solo italiano' } },
  })
  expect(italianOnly.body).toMatchObject({ title: 'Solo italiano', path: '', locales: ['it'] })

  const ids = async (query: string) =>
    (await listItems('categories', query)).body.rows.map((row) => row.id).sort()
  expect(await ids('availableIn=it')).toEqual([everywhere.body.id, italianOnly.body.id].sort())
  expect(await ids('availableIn=en')).toEqual([everywhere.body.id, englishOnly.body.id].sort())
  const refused = await listItems('categories', 'availableIn=fr')
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ _tag: 'CmsInvalid' })
})

test('the Read API lists an unrouted item only in the locales it is available in', async () => {
  const everywhere = await createItem('categories', { locales: {}, data: { name: { en: 'Both' } } })
  const englishOnly = await createItem('categories', {
    locales: { it: unavailable },
    data: { name: { en: 'Only en' } },
  })
  for (const { body } of [everywhere, englishOnly])
    expect((await host.publishDraft(`/items/${body.id}`)).status).toBe(200)

  type List = { rows: Array<{ id: string }> }
  const ids = async (query: string) =>
    (await read<List>(`/collections/categories?${query}`)).body.rows.map((row) => row.id).sort()
  expect(await ids('locale=en')).toEqual([everywhere.body.id, englishOnly.body.id].sort())
  expect(await ids('locale=it')).toEqual([everywhere.body.id])
})

test('publishing checks required localized fields in each available locale, the default filling in', async () => {
  const italianPage = (title: Record<string, string>) =>
    host.create({
      locales: { it: locale('/solo-it-' + crypto.randomUUID().slice(0, 8)) },
      sections: [section('hero', { title })],
    })
  const filled = (await italianPage({ it: 'Ciao' })).body
  expect((await host.publish(filled.id)).status).toBe(200)
  const fromDefault = (await italianPage({ en: 'Hello' })).body
  expect((await host.publish(fromDefault.id)).status).toBe(200)
  const empty = (await italianPage({})).body
  const refused = await host.publish(empty.id)
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ message: 'Section 1 (Hero): "Title" is required in it.' })

  const english = await host.create({
    locales: { en: locale('/needs-en'), it: locale('/serve-en') },
    sections: [section('hero', { title: { it: 'Ciao' } })],
  })
  expect((await host.publish(english.body.id)).body).toMatchObject({
    message: 'Section 1 (Hero): "Title" is required in en.',
  })

  const post = await createItem('posts', {
    locales: { it: locale('/blog/pubblicato') },
    data: { title: { it: 'Pubblicato' } },
  })
  expect((await host.publishDraft<Item>(`/items/${post.body.id}`)).body).toMatchObject({
    status: 'published',
  })
  const untitled = await createItem('posts', {
    locales: { it: locale('/blog/senza-titolo') },
    data: {},
  })
  expect((await host.publishDraft(`/items/${untitled.body.id}`)).body).toMatchObject({
    message: 'Posts: "Title" is required in it.',
  })
})

test('migration 0006 makes stored unrouted items available in every locale without changing their status', async () => {
  const create = async (name: string) =>
    (await createItem('categories', { locales: {}, data: { name: { en: name } } })).body.id
  const draft = await create('Draft')
  const published = await create('Published')
  const changed = await create('Changed')
  await host.publishDraft(`/items/${published}`)
  await host.publishDraft(`/items/${changed}`)
  await host.saveDraft(`/items/${changed}`, { locales: {}, data: { name: { en: 'Changed 2' } } })
  const post = await createItem('posts', {
    locales: { en: locale('/blog/routed'), it: unavailable },
    data: { title: { en: 'Routed' } },
  })

  const unavailableEverywhere = (column: string) =>
    `jsonb_set(${column}, '{locales}', (select jsonb_object_agg(k, v || '{"available": false}')
      from jsonb_each(${column}->'locales') e(k, v)))`
  await host.query(`update cms.document set draft = ${unavailableEverywhere('draft')},
    published = case when published is not null then ${unavailableEverywhere('published')} end
    where kind = 'item' and key = 'categories'`)
  const statuses = async () =>
    Object.fromEntries(
      (await listItems('categories', `ids=${[draft, published, changed].join(',')}`)).body.rows.map(
        (row) => [row.id, [row.status, row.locales]],
      ),
    )
  expect(await statuses()).toEqual({
    [draft]: ['draft', []],
    [published]: ['published', []],
    [changed]: ['changed', []],
  })

  await host.query(`delete from cms.migrations where migration_id = 6`)
  await runOpulon(['migrate', '--server', 'fixtures/host/server/opulon.ts'], {
    DATABASE_URL_DIRECT: host.db.url,
  })
  expect(await statuses()).toEqual({
    [draft]: ['draft', ['en', 'it']],
    [published]: ['published', ['en', 'it']],
    [changed]: ['changed', ['en', 'it']],
  })
  expect((await host.call<Item>('GET', `/items/${post.body.id}`)).body.locales).toEqual(['en'])
  type List = { rows: Array<{ id: string }> }
  const italian = await read<List>(
    `/collections/categories?locale=it&ids=${[draft, published, changed].join(',')}`,
  )
  expect(italian.body.rows.map((row) => row.id).sort()).toEqual([published, changed].sort())
})
