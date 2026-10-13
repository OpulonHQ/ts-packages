import type { Item, ItemSummary } from '@opulonjs/cms/api'
import { beforeAll, expect, test } from 'vitest'
import { locale, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const ids: string[] = []
let foreignId: string
beforeAll(async () => {
  for (let n = 1; n <= 31; n++) {
    const number = String(n).padStart(2, '0')
    const result = await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        data: { title: { en: `Paging ${number}`, it: `Italian ${number}` } },
        locales: { en: locale(`/paging-${number}`) },
      },
    })
    expect(result.status).toBe(200)
    ids.push(result.body.id)
  }
  foreignId = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { data: { name: { en: 'Paging outside' } }, locales: {} },
    })
  ).body.id
})

const list = async (query: string) => {
  const result = await host.call<{ rows: ItemSummary[]; total: number }>(
    'GET',
    `/collections/posts/items?${query}`,
  )
  expect(result.status).toBe(200)
  return result.body
}

test('items page, sort and search default-locale titles and paths on the server', async () => {
  expect(await list('search=Paging&perPage=10&sort=title&direction=asc')).toMatchObject({
    total: 31,
    rows: ids.slice(0, 10).map((id) => ({ id })),
  })
  expect(await list('search=Paging&perPage=10&page=2&sort=title&direction=asc')).toMatchObject({
    total: 31,
    rows: ids.slice(10, 20).map((id) => ({ id })),
  })
  expect(await list('search=%20PAGING-31%20&sort=path&direction=desc')).toMatchObject({
    total: 1,
    rows: [{ id: ids[30], title: 'Paging 31', path: '/paging-31' }],
  })
  expect(await list('search=Italian')).toEqual({ rows: [], total: 0 })
  expect(await list('page=5&perPage=10')).toEqual({ rows: [], total: 31 })
  expect((await list('sort=title&direction=desc&perPage=2')).rows.map((r) => r.title)).toEqual([
    'Paging 31',
    'Paging 30',
  ])
})

test.each([
  'page=0',
  'perPage=101',
  'page=402',
  'page=102&perPage=100',
  'sort=draft',
  'direction=oops',
])('items reject invalid or excessive query %s', async (query) => {
  expect((await host.call('GET', `/collections/posts/items?${query}`)).status).toBe(400)
})

test('item paging denies signed-in staff lacking collections.view', async () => {
  expect(
    (
      await host.call('GET', '/collections/posts/items?page=2&search=Paging', {
        as: ['cms.pages.view'],
      })
    ).status,
  ).toBe(403)
  expect(
    (await host.call('GET', `/collections/posts/items?ids=${ids[0]}`, { as: ['cms.pages.view'] }))
      .status,
  ).toBe(403)
})

test('item ID batches are scoped to the path collection, deduplicated and ordered', async () => {
  const query = new URLSearchParams({
    ids: [ids[30], foreignId, ids[0], ids[0]?.toUpperCase()].join(','),
    perPage: '100',
    sort: 'title',
    direction: 'asc',
  })
  const result = await list(query.toString())
  expect(result.total).toBe(2)
  expect(result.rows.map((row) => row.title)).toEqual(['Paging 01', 'Paging 31'])
  expect(result.rows.every((row) => !('draft' in row) && !('published' in row))).toBe(true)
  expect(await list(`ids=${foreignId}`)).toEqual({ rows: [], total: 0 })
  expect(await list(`ids=${Array.from({ length: 100 }, () => ids[0]).join(',')}`)).toMatchObject({
    total: 1,
    rows: [{ id: ids[0] }],
  })
})

test.each([
  '',
  'not-a-uuid',
  '00000000-0000-0000-0000-00000000000z',
  Array.from({ length: 101 }, () => '12345678-1234-4123-8123-123456789abc').join(','),
])('item ID batches reject empty, malformed or over-cap inputs %s', async (ids) => {
  expect(
    (await host.call('GET', `/collections/posts/items?ids=${encodeURIComponent(ids)}`)).status,
  ).toBe(400)
})
