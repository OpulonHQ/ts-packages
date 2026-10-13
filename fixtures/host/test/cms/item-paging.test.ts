import type { Item, ItemSummary } from '@opulonjs/cms/api'
import { beforeAll, expect, test } from 'vitest'
import { locale, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const ids: string[] = []
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
  await host.call('POST', '/collections/categories/items', {
    body: { data: { name: { en: 'Paging outside' } }, locales: {} },
  })
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
})
