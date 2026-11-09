import { defineCms, fields, type Item, type Page } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect, test } from 'vitest'
import { adminModules } from '../../admin/modules.ts'
import { definitions as hostDefinitions } from '../../cms/definitions.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, saveDraft, section, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const mountAdmin = (path: string) => admin.mount(path, { fetch: host.fetch })

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const input = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const stored = async (id: string) => (await host.call<Page>('GET', `/pages/${id}`)).body

test('a field naming an unregistered widget fails composition', () => {
  const definitions = defineCms({
    sections: {
      banner: {
        label: 'Banner',
        fields: { tint: fields.text({ label: 'Tint', widget: 'swatch' }) },
      },
    },
    systemPages: {},
  })
  expect(() => cmsAdmin({ definitions })).toThrow(
    'field "tint" of section type "banner" uses the widget "swatch", which is not registered',
  )
  expect(() =>
    cmsAdmin({ definitions, widgets: { swatch: async () => ({ default: {} }) } }),
  ).not.toThrow()
})

test('pages list system pages; an editor edits the draft in generated forms and publishes', async () => {
  const created = (
    await host.create(
      page({ en: '/about', it: '/chi-siamo' }, [section('hero', { tone: 'light' })]),
    )
  ).body
  const text = mountAdmin('/admin/cms/pages')
  await expect.poll(text).toContain('Domovská stránka')
  expect(text()).toContain('Systémová stránka')
  expect(document.querySelector('nav')?.textContent).toContain('Stránky')

  history.replaceState(null, '', `/admin/cms/pages/${created.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  // Localized fields get one tab per content locale; the custom widget is the host's.
  expect(input('sections.0.title.it')).toBeTruthy()
  await expect.poll(() => document.querySelector('input[type="color"]')).toBeTruthy()
  expect(text()).toContain('Farba zvýraznenia')

  type('sections.0.title.en', 'About us')
  type('locales.en.seo.title', 'About')
  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  const draft = await stored(created.id)
  expect(draft.draft.sections[0]?.data).toEqual({ title: { en: 'About us' }, tone: 'light' })
  expect(draft.draft.locales.en?.seo.title).toBe('About')
  expect(draft.status).toBe('draft')

  button('Zverejniť')!.click()
  await expect.poll(text).toContain('Zverejnené.')
  expect((await stored(created.id)).status).toBe('published')
  expect(button('Zrušiť zverejnenie')).toBeDefined()
  // An editor's own page can be deleted; system pages offer no delete.
  expect(button('Vymazať')).toBeDefined()
})

const choice = (label: string) =>
  [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined
const colorWidget = () => import('../../cms/ColorWidget.vue')
const openedPage = async () => {
  await expect.poll(() => location.pathname).toMatch(/^\/admin\/cms\/pages\/[0-9a-f-]{36}$/)
  return location.pathname.split('/').at(-1)!
}

test('a new page starts from a template: its sections open prefilled and already stored', async () => {
  const text = mountAdmin('/admin/cms/pages')
  await expect.poll(() => button('Nová stránka')).toBeDefined()
  button('Nová stránka')!.click()
  await expect.poll(() => choice('Vstupná stránka')).toBeDefined()
  expect(choice('Vstupná stránka')!.textContent).toContain('Úvodný blok, čísla a úvodný text.')
  expect(choice('Vstupná stránka')!.textContent).toContain('Úvodný blok, Stats, Formátovaný text')
  expect(choice('Prázdna stránka')).toBeDefined()

  choice('Vstupná stránka')!.click()
  const id = await openedPage()
  await expect.poll(() => input('sections.0.title.en')?.value).toBe('Welcome')
  expect(input('sections.0.title.it')?.value).toBe('Benvenuti')
  expect(text()).not.toContain('Neuložené zmeny')
  const { sections } = (await stored(id)).draft
  expect(sections.map(({ type, data }) => ({ type, data }))).toEqual([
    { type: 'hero', data: { title: { en: 'Welcome', it: 'Benvenuti' }, tone: 'dark' } },
    { type: 'stats', data: { count: 120, visible: true, note: 'Happy customers' } },
    { type: 'rich_text', data: { body: { en: '<p>Tell visitors what you offer.</p>' } } },
  ])
  expect(new Set(sections.map((s) => s.id)).size).toBe(3)
})

test('a blank page starts without sections', async () => {
  mountAdmin('/admin/cms/pages')
  await expect.poll(() => button('Nová stránka')).toBeDefined()
  button('Nová stránka')!.click()
  await expect.poll(() => choice('Prázdna stránka')).toBeDefined()
  choice('Prázdna stránka')!.click()
  expect((await stored(await openedPage())).draft.sections).toEqual([])
})

test('without templates, a new page is created in one click', async () => {
  const definitions = { ...hostDefinitions, templates: {} }
  const modules = adminModules.map((module) =>
    module.id === 'cms' ? cmsAdmin({ definitions, widgets: { color: colorWidget } }) : module,
  )
  admin.mount('/admin/cms/pages', { fetch: host.fetch, modules })
  await expect.poll(() => button('Nová stránka')).toBeDefined()
  button('Nová stránka')!.click()
  expect((await stored(await openedPage())).draft.sections).toEqual([])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('a system page offers no delete', async () => {
  const { body } = await host.call<{ rows: Array<{ id: string; systemKey: string | null }> }>(
    'GET',
    '/pages',
  )
  const home = body.rows.find((r) => r.systemKey === 'home')!
  const text = mountAdmin(`/admin/cms/pages/${home.id}`)
  await expect.poll(text).toContain('Zverejniť')
  expect(button('Vymazať')).toBeUndefined()
  await expect.poll(text).toContain('Zatiaľ žiadne publikované revízie.')
})

test('a collection list filters by the fields its definition names; others show no filters', async () => {
  const category = async (name: string) =>
    (
      await host.call<Item>('POST', '/collections/categories/items', {
        body: { locales: {}, data: { name: { en: name } } },
      })
    ).body.id
  const [news, law] = [await category('News'), await category('Law')]
  for (const data of [
    { title: { en: 'Listed A' }, categories: [news] },
    { title: { en: 'Listed B' }, categories: [law, news], kind: 'guide' },
    { title: { en: 'Listed C' } },
  ])
    await host.call('POST', '/collections/posts/items', { body: { locales: {}, data } })

  const text = mountAdmin('/admin/cms/collections/posts')
  await expect.poll(text).toContain('Listed C')
  const titles = () => ['Listed A', 'Listed B', 'Listed C'].filter((t) => text().includes(t))
  const filterControls = () => document.querySelectorAll('section [aria-haspopup="listbox"]')
  expect(filterControls()).toHaveLength(2)

  await pick('Kategórie', 'News')
  await expect.poll(titles).toEqual(['Listed A', 'Listed B'])
  await pick('Druh', 'Návod')
  await expect.poll(titles).toEqual(['Listed B'])
  button('Zrušiť filtre')!.click()
  await expect.poll(titles).toEqual(['Listed A', 'Listed B', 'Listed C'])

  history.replaceState(null, '', '/admin/cms/collections/categories')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(text).toContain('Law')
  expect(filterControls()).toHaveLength(0)
})

async function pick(filter: string, option: string) {
  document.querySelector<HTMLElement>(`[aria-haspopup="listbox"][aria-label="${filter}"]`)!.click()
  const item = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => el.textContent?.trim() === option,
    )
  await expect.poll(item).toBeDefined()
  item()!.click()
}
