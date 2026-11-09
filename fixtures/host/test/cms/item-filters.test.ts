import type { Item, ItemSummary } from '@opulonjs/cms/api'
import { beforeAll, expect, test } from 'vitest'
import { useCmsHost } from './helpers.ts'

const host = useCmsHost()
let news: string
let law: string
const posts: Record<string, string> = {}
beforeAll(async () => {
  const category = async (name: string) =>
    (
      await host.call<Item>('POST', '/collections/categories/items', {
        body: { locales: {}, data: { name: { en: name } } },
      })
    ).body.id
  news = await category('News')
  law = await category('Law')
  for (const [title, data] of [
    ['Filter A', { categories: [news], kind: 'news' }],
    ['Filter B', { categories: [law, news], kind: 'guide' }],
    ['Filter C', { categories: [law] }],
    ['Filter D', { kind: 'news' }],
    ['Filter E', {}],
  ] as const) {
    const result = await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: title }, ...data } },
    })
    expect(result.status).toBe(200)
    posts[title] = result.body.id
  }
})

const titles = async (query: URLSearchParams) => {
  query.set('sort', 'title')
  query.set('direction', 'asc')
  const result = await host.call<{ rows: ItemSummary[]; total: number }>(
    'GET',
    `/collections/posts/items?${query}`,
  )
  expect(result.status).toBe(200)
  return { total: result.body.total, titles: result.body.rows.map((row) => row.title) }
}

test('a reference filter lists the items whose draft holds the referenced item', async () => {
  expect(await titles(new URLSearchParams({ filter: `categories:${news}` }))).toEqual({
    total: 2,
    titles: ['Filter A', 'Filter B'],
  })
  expect(await titles(new URLSearchParams({ filter: `categories:${law}` }))).toEqual({
    total: 2,
    titles: ['Filter B', 'Filter C'],
  })
})

test('a select filter lists the items holding the option', async () => {
  expect(await titles(new URLSearchParams({ filter: 'kind:news' }))).toEqual({
    total: 2,
    titles: ['Filter A', 'Filter D'],
  })
})

test('filters combine with each other, search and paging', async () => {
  expect(
    await titles(
      new URLSearchParams([
        ['filter', `categories:${news}`],
        ['filter', 'kind:guide'],
      ]),
    ),
  ).toEqual({ total: 1, titles: ['Filter B'] })
  expect(
    await titles(new URLSearchParams({ filter: `categories:${law}`, search: 'filter c' })),
  ).toEqual({ total: 1, titles: ['Filter C'] })
  expect(
    await titles(new URLSearchParams({ filter: `categories:${law}`, perPage: '1', page: '2' })),
  ).toEqual({ total: 2, titles: ['Filter C'] })
})

test('a filter on a field the collection does not name is refused', async () => {
  for (const filter of ['title:Filter A', 'cover:x', 'unknown:x']) {
    const result = await host.call(
      'GET',
      `/collections/posts/items?${new URLSearchParams({ filter })}`,
    )
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ _tag: 'CmsInvalid' })
  }
  expect(
    (await host.call('GET', `/collections/categories/items?filter=categories:${news}`)).status,
  ).toBe(400)
})

test.each(['categories', 'categories:', ':news'])(
  'a malformed filter %s is refused',
  async (filter) => {
    expect(
      (await host.call('GET', `/collections/posts/items?${new URLSearchParams({ filter })}`))
        .status,
    ).toBe(400)
  },
)
