import type { Item, SiteSettings } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { cms } from '@opulonjs/cms/server'
import { composeServer } from '@opulonjs/core'
import { Schema } from 'effect'
import { expect, test } from 'vitest'
import { adminModules } from '../../admin/modules.ts'
import { definitions } from '../../cms/definitions.ts'
import { server } from '../../server/opulon.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { useCmsHost } from './helpers.ts'

const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
const largeDefinitions = {
  ...definitions,
  collections: {
    ...definitions.collections,
    posts: {
      ...definitions.collections.posts,
      fields: {
        ...definitions.collections.posts.fields,
        categories: {
          ...definitions.collections.posts.fields.categories,
          schema: Schema.Array(Schema.String.check(Schema.isUUID())).check(Schema.isMaxLength(200)),
        },
      },
    },
  },
}
const largeHost = admin.track(
  useCmsHost(
    composeServer({
      modules: server.modules.map((module) =>
        module.id === 'cms' ? cms({ definitions: largeDefinitions }) : module,
      ),
      contentLocales: ['en', 'it'],
    }),
  ),
)
const createItems = async (
  target: typeof host,
  collection: string,
  count: number,
  data: (n: string) => Record<string, unknown>,
) => {
  const items: Item[] = []
  for (let start = 1; start <= count; start += 10) {
    const created = await Promise.all(
      Array.from({ length: Math.min(10, count - start + 1) }, (_, i) =>
        target.call<Item>('POST', `/collections/${collection}/items`, {
          body: { locales: {}, data: data(String(start + i).padStart(String(count).length, '0')) },
        }),
      ),
    )
    for (const item of created) {
      expect(item.status).toBe(200)
      items.push(item.body)
    }
  }
  return items
}

test('a reference picker searches beyond page one, retains selections and discards a slow older search', async () => {
  const ids = (
    await createItems(host, 'categories', 31, (n) => ({ name: { en: `Picker ${n}` } }))
  ).map((item) => item.id)
  const post = await host.call<Item>('POST', '/collections/posts/items', {
    body: { locales: {}, data: { title: { en: 'References' }, categories: [ids[30]] } },
  })
  const gate = admin.gate()
  const labelsGate = admin.gate()
  let blockResolved = false
  let searched = false
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (blockResolved && new URL(request.url).pathname.endsWith(`/items/${ids[30]}`)) {
      await labelsGate.promise
    }
    if (new URL(request.url).searchParams.get('search') === 'Picker 01') {
      searched = true
      await gate.promise
    }
    return response
  }
  admin.mount(`/admin/cms/items/${post.body.id}`, { fetch })
  const picker = () =>
    [...document.querySelectorAll<HTMLTableElement>('table')].find(
      (table) => table.caption?.textContent?.trim() === 'Kategórie',
    )
  const rows = () =>
    [...(picker()?.querySelectorAll('tbody tr') ?? [])].map((row) => row.textContent?.trim())
  await expect.poll(rows).toHaveLength(25)
  await expect.poll(() => document.querySelector('[aria-label="Odstrániť Picker 31"]')).toBeTruthy()
  blockResolved = true
  const search = () =>
    document.querySelector<HTMLInputElement>('input[placeholder="Hľadať položky…"]')
  await expect.poll(search).toBeTruthy()
  const type = (value: string) => {
    const input = search()
    if (!input) throw new Error('reference search is missing')
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  type('Picker 01')
  await expect.poll(() => searched).toBe(true)
  type('Picker 30')
  await expect.poll(rows).toEqual(['Picker 30'])
  gate.resolve()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(rows()).toEqual(['Picker 30'])
  expect(document.querySelector('[aria-label="Odstrániť Picker 31"]')).toBeTruthy()
  picker()?.querySelector<HTMLElement>('tbody tr')?.click()
  await expect.poll(() => document.querySelector('[aria-label="Odstrániť Picker 30"]')).toBeTruthy()
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Uložiť koncept',
  )
  expect(save).toBeTruthy()
  save?.click()
  await expect
    .poll(
      async () =>
        (await host.call<Item>('GET', `/items/${post.body.id}`)).body.draft.data.categories,
    )
    .toEqual([ids[30], ids[29]])
})

test('a single item link resolves a target beyond page one and can be cleared and saved', async () => {
  const links = await createItems(host, 'posts', 31, (n) => ({ title: { en: `Link ${n}` } }))
  const late = links.at(-1)
  if (!late) throw new Error('no item was created')
  expect(
    (
      await host.call('PUT', '/settings/draft', {
        body: { data: { cta: { type: 'item', id: late.id } } },
      })
    ).status,
  ).toBe(200)
  admin.mount('/admin/cms/settings', { fetch: host.fetch })
  const clear = () => document.querySelector<HTMLButtonElement>('[aria-label="Odstrániť Link 31"]')
  await expect.poll(clear).toBeTruthy()
  clear()?.click()
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Uložiť koncept',
  )
  save?.click()
  await expect
    .poll(async () => (await host.call<SiteSettings>('GET', '/settings')).body.draft.data.cta)
    .toBeUndefined()
})

test('saved reference labels load together while individual document requests cannot settle', async () => {
  const ids: string[] = []
  for (const title of ['Batch first', 'Batch second']) {
    const result = await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: title } } },
    })
    ids.push(result.body.id)
  }
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Batch picker' }, categories: ids } },
    })
  ).body
  const gate = admin.gate()
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (ids.some((id) => new URL(request.url).pathname.endsWith(`/items/${id}`))) await gate.promise
    return response
  }
  admin.mount(`/admin/cms/items/${post.id}`, { fetch })
  await expect
    .poll(() => document.querySelector('[aria-label="Odstrániť Batch first"]'))
    .toBeTruthy()
  await expect
    .poll(() => document.querySelector('[aria-label="Odstrániť Batch second"]'))
    .toBeTruthy()
})

test('a host with larger many-reference fields resolves all 101 saved references without a load error', async () => {
  const ids = (
    await createItems(largeHost, 'categories', 101, (n) => ({ name: { en: `Bulk ${n}` } }))
  ).map((item) => item.id)
  const post = await largeHost.call<Item>('POST', '/collections/posts/items', {
    body: { locales: {}, data: { title: { en: 'Large reference field' }, categories: ids } },
  })
  expect(post.status).toBe(200)
  admin.mount(`/admin/cms/items/${post.body.id}`, {
    fetch: largeHost.fetch,
    modules: adminModules.map((module) =>
      module.id === 'cms'
        ? cmsAdmin({
            definitions: largeDefinitions,
            widgets: { color: () => import('../../cms/ColorWidget.vue') },
          })
        : module,
    ),
  })
  await expect
    .poll(() => document.querySelectorAll('[aria-label^="Odstrániť Bulk "]').length)
    .toBe(101)
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('a deleted saved reference is marked missing and remains removable without a load-failed alert', async () => {
  const category = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: 'Deleted reference' } } },
    })
  ).body
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        locales: {},
        data: { title: { en: 'Missing reference field' }, categories: [category.id] },
      },
    })
  ).body
  expect((await host.call('DELETE', `/items/${category.id}`)).status).toBe(204)
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  const remove = () =>
    document.querySelector<HTMLButtonElement>(
      `[aria-label="Odstrániť Chýbajúca alebo vymazaná položka (${category.id})"]`,
    )
  await expect.poll(remove).toBeTruthy()
  expect(document.querySelector('[role="alert"]')).toBeNull()
  remove()?.click()
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Uložiť koncept',
  )
  save?.click()
  await expect
    .poll(
      async () => (await host.call<Item>('GET', `/items/${post.id}`)).body.draft.data.categories,
    )
    .toEqual([])
})

test('a stored reference that is not an item ID is marked missing while the others resolve', async () => {
  const category = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: 'Valid reference' } } },
    })
  ).body
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Legacy reference' }, categories: [category.id] } },
    })
  ).body
  await host.query(
    `update cms.document set draft = jsonb_set(draft, '{data,categories}', '["legacy-ref", "${category.id}"]') where id = '${post.id}'`,
  )
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect
    .poll(() => document.querySelector('[aria-label="Odstrániť Valid reference"]'))
    .toBeTruthy()
  expect(
    document.querySelector(
      '[aria-label="Odstrániť Chýbajúca alebo vymazaná položka (legacy-ref)"]',
    ),
  ).toBeTruthy()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('a failed reference summary request shows a load alert without marking the item deleted', async () => {
  const category = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: 'Available reference' } } },
    })
  ).body
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        locales: {},
        data: { title: { en: 'Unavailable summary request' }, categories: [category.id] },
      },
    })
  ).body
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).searchParams.has('ids'))
      return Promise.resolve(new Response('', { status: 503 }))
    return host.fetch(request)
  }
  admin.mount(`/admin/cms/items/${post.id}`, { fetch })
  await expect.poll(() => document.querySelector('[role="alert"]')).toBeTruthy()
  expect(document.body.textContent).not.toContain('Chýbajúca alebo vymazaná položka')
})
