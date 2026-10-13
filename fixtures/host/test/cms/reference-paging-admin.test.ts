import { createAdmin } from '@opulonjs/admin'
import type { Item, SiteSettings } from '@opulonjs/cms/api'
import { expect, onTestFinished, test } from 'vitest'
import { brand } from '../../admin/brand.ts'
import { adminModules } from '../../admin/modules.ts'
import { useCmsHost } from './helpers.ts'

const host = useCmsHost()

test('a reference picker searches beyond page one, retains selections and discards a slow older search', async () => {
  const ids: string[] = []
  for (let n = 1; n <= 31; n++) {
    const result = await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: `Picker ${String(n).padStart(2, '0')}` } } },
    })
    expect(result.status).toBe(200)
    ids.push(result.body.id)
  }
  const post = await host.call<Item>('POST', '/collections/posts/items', {
    body: { locales: {}, data: { title: { en: 'References' }, categories: [ids[30]] } },
  })
  const gate = Promise.withResolvers<void>()
  const labelsGate = Promise.withResolvers<void>()
  let blockResolved = false
  const reached = Promise.withResolvers<void>()
  onTestFinished(() => gate.resolve())
  onTestFinished(() => labelsGate.resolve())
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (blockResolved && new URL(request.url).pathname.endsWith(`/items/${ids[30]}`)) {
      await labelsGate.promise
    }
    if (new URL(request.url).searchParams.get('search') === 'Picker 01') {
      reached.resolve()
      await gate.promise
    }
    return response
  }
  history.replaceState(null, '', `/admin/cms/items/${post.body.id}`)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({ brand, modules: adminModules, buildId: 'build-1', fetch })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  const rows = () =>
    [...document.querySelectorAll('table tbody tr')].map((row) => row.textContent?.trim())
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
  await reached.promise
  type('Picker 30')
  await expect.poll(rows).toEqual(['Picker 30'])
  gate.resolve()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(rows()).toEqual(['Picker 30'])
  expect(document.querySelector('[aria-label="Odstrániť Picker 31"]')).toBeTruthy()
  document.querySelector<HTMLElement>('table tbody tr')?.click()
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
  let late: Item | undefined
  for (let n = 1; n <= 31; n++) {
    late = (
      await host.call<Item>('POST', '/collections/posts/items', {
        body: { locales: {}, data: { title: { en: `Link ${String(n).padStart(2, '0')}` } } },
      })
    ).body
  }
  if (!late) throw new Error('no item was created')
  expect(
    (
      await host.call('PUT', '/settings/draft', {
        body: { data: { cta: { type: 'item', id: late.id } } },
      })
    ).status,
  ).toBe(200)
  history.replaceState(null, '', '/admin/cms/settings')
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({ brand, modules: adminModules, buildId: 'build-1', fetch: host.fetch })
  app.mount('#app')
  onTestFinished(() => app.unmount())
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
