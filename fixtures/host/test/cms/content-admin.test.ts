import { createAdmin } from '@opulonjs/admin'
import { defineCms, fields, type Item, type Menu, type SiteSettings } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect, onTestFinished, test } from 'vitest'
import { brand } from '../../admin/brand.ts'
import { adminModules } from '../../admin/modules.ts'
import { files } from '../media/helpers.ts'
import { useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk.
const host = useCmsHost()

const failed = useCmsHost(undefined, async () => ({
  success: false,
  errors: [{ code: 1, message: 'private diagnostic' }],
}))

let mediaPurgeRefused = false
const mediaOnly = useCmsHost(undefined, async () => ({
  success: !mediaPurgeRefused,
  errors: mediaPurgeRefused ? [{ code: 1, message: 'private media diagnostic' }] : [],
}))

test('a media-only editor sees one purge warning after edits, replacement, archive and closing details', async () => {
  mediaPurgeRefused = false
  await mediaOnly.upload(files.png(800, 600), 'media-only.png')
  const fetch = mediaOnly.fetchAs(['media.view', 'media.upload', 'media.archive'])
  const text = mountAdmin('/admin/media', fetch)
  const row = () =>
    [...document.querySelectorAll<HTMLElement>('tbody tr')].find((row) =>
      row.textContent?.includes('media-only.png'),
    )
  await expect.poll(row).toBeTruthy()
  row()!.click()
  await expect.poll(() => input('alt.en')).toBeTruthy()
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  mediaPurgeRefused = true
  type('alt.en', 'Media-only edit')
  button('Uložiť')!.click()
  await expect.poll(text).toContain('Uložené.')
  const warnings = () =>
    [...document.querySelectorAll('[role="status"]')].filter((notice) =>
      notice.textContent?.includes('Živý web môže zobrazovať predchádzajúcu verziu'),
    )
  await expect.poll(warnings).toHaveLength(1)
  expect(text()).not.toContain('private media diagnostic')

  const recover = async () => {
    mediaPurgeRefused = false
    await mediaOnly.query(
      "update core.cache_purge set next_attempt_at = now() - interval '1 second'",
    )
    await mediaOnly.sweep()
    button('Uložiť')!.click()
    await expect.poll(warnings).toHaveLength(0)
  }
  await recover()
  mediaPurgeRefused = true
  const replacement = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="file"]',
  )!
  Object.defineProperty(replacement, 'files', {
    value: [new File([files.png(40, 30).slice()], 'replacement.png', { type: 'image/png' })],
    configurable: true,
  })
  replacement.dispatchEvent(new Event('change'))
  await expect.poll(text).toContain('Súbor bol nahradený.')
  await expect.poll(warnings).toHaveLength(1)
  await recover()
  mediaPurgeRefused = true
  button('Archivovať')!.click()
  await expect.poll(text).toContain('stránky, ktoré ju už používajú')
  ;[...document.querySelectorAll('button')]
    .filter((button) => button.textContent?.trim() === 'Archivovať')
    .at(-1)!
    .click()
  await expect.poll(text).toContain('Archivované.')
  await expect.poll(warnings).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('button[data-slot="close"]')!.click()
  await expect.poll(() => input('alt.en')).toBeFalsy()
  await expect.poll(warnings).toHaveLength(1)
})

test('a media view-only editor does not see an unavailable purge status warning', async () => {
  await failed.upload(files.png(800, 600), 'view-only.png')
  const text = mountAdmin('/admin/media', failed.fetchAs(['media.view']))
  await expect.poll(text).toContain('view-only.png')
  expect(text()).not.toContain('Stav vymazania vyrovnávacej pamäte nie je dostupný')
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
})

function mountAdmin(path: string, fetch = host.fetch) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({ brand, modules: adminModules, buildId: 'build-1', fetch })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return () => document.body.textContent ?? ''
}

test('the composed admin shows an editor the real failed purge from a media edit', async () => {
  const id = await failed.upload(files.png(800, 600), 'notice.png')
  const changed = await failed.fetch(`https://host.test/api/media/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alt: { en: 'Edited alt' }, caption: { en: 'Edited caption' } }),
  })
  expect(changed.status).toBe(200)
  const text = mountAdmin('/admin/cms/pages', failed.fetch)
  await expect.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).toContain('vymazanie vyrovnávacej pamäte')
  expect(text()).not.toContain('private diagnostic')
})

test('a collection-only editor can see the real pending purge on their content screen', async () => {
  await failed.upload(files.png(800, 600), 'collection-notice.png', { en: 'Collection image' })
  const text = mountAdmin('/admin/cms/collections/posts', failed.fetchAs(['cms.collections.view']))
  await expect.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).not.toContain('private diagnostic')
})

test('the loaded menu editor shows one purge warning', async () => {
  await failed.upload(files.png(800, 600), 'menu-notice.png', { en: 'Menu image' })
  const requests: Array<Promise<Response>> = []
  const fetch: typeof failed.fetch = (input, init) => {
    const response = failed.fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/cache-purges')) requests.push(response)
    return response
  }
  mountAdmin('/admin/cms/menus/main', fetch)
  await expect.poll(() => button('Zverejniť')).toBeTruthy()
  await Promise.all(requests)
  await failed.call('GET', '/menus/main')
  await expect
    .poll(() =>
      [...document.querySelectorAll('[role="status"]')].filter((notice) =>
        notice.textContent?.includes('Živý web môže zobrazovať predchádzajúcu verziu'),
      ),
    )
    .toHaveLength(1)
})

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}

test('a collection field naming an unregistered widget fails composition', () => {
  const definitions = defineCms({
    sections: {},
    systemPages: {},
    collections: {
      team: { label: 'Team', fields: { tint: fields.text({ label: 'Tint', widget: 'swatch' }) } },
    },
  })
  expect(() => cmsAdmin({ definitions })).toThrow(
    'field "tint" of collection "team" uses the widget "swatch", which is not registered',
  )
})

test('editors manage collection items in generated forms and publish them', async () => {
  const category = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: 'News' } } },
    })
  ).body
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Draft post' } } },
    })
  ).body

  const text = mountAdmin('/admin/cms/collections/posts')
  await expect.poll(text).toContain('Draft post')
  const nav = document.querySelector('nav')?.textContent
  expect(nav).toContain('Kolekcie')
  expect(nav).toContain('Menu')
  expect(nav).toContain('Nastavenia webu')

  history.replaceState(null, '', `/admin/cms/items/${post.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(() => input('data.title.en')).toBeTruthy()
  // Routed collections edit path and SEO; references offer the collection's items.
  expect(input('locales.en.path')).toBeTruthy()
  await expect.poll(text).toContain('News')

  type('data.title.en', 'Hello world')
  type('locales.en.path', '/blog/hello-world')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  const saved = (await host.call<Item>('GET', `/items/${post.id}`)).body
  expect(saved.draft.data).toEqual({ title: { en: 'Hello world' } })
  expect(saved.draft.locales.en?.path).toBe('/blog/hello-world')

  button('Zverejniť')!.click()
  await expect.poll(text).toContain('Zverejnené.')
  expect((await host.call<Item>('GET', `/items/${post.id}`)).body.status).toBe('published')
  expect(category.title).toBe('News')
})

test('editors edit and publish the site settings', async () => {
  const text = mountAdmin('/admin/cms/settings')
  await expect.poll(() => input('data.phone')).toBeTruthy()
  expect(input('data.siteName.it')).toBeTruthy()
  type('data.phone', '+421 900 111 222')
  type('data.siteName.en', 'Example')
  button('Zverejniť')!.click()
  await expect.poll(text).toContain('Zverejnené.')
  const settings = (await host.call<SiteSettings>('GET', '/settings')).body
  expect(settings.status).toBe('published')
  expect(settings.published?.data).toEqual({
    phone: '+421 900 111 222',
    siteName: { en: 'Example' },
  })
})

test('editors build a menu from entries with labels per locale and links', async () => {
  const text = mountAdmin('/admin/cms/menus/main')
  await expect.poll(() => button('Pridať položku')).toBeTruthy()
  expect(text()).toContain('Hlavné menu')
  button('Pridať položku')!.click()
  await expect.poll(() => input('items.0.label.en')).toBeTruthy()
  type('items.0.label.en', 'Docs')
  type('items.0.label.it', 'Documenti')
  type('items.0.link.url', 'https://example.test/docs')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  const menu = (await host.call<Menu>('GET', '/menus/main')).body
  expect(menu.draft.items).toEqual([
    {
      id: expect.any(String),
      label: { en: 'Docs', it: 'Documenti' },
      link: { type: 'url', url: 'https://example.test/docs' },
      children: [],
    },
  ])
})
