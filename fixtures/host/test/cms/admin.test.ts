import { defineCms, fields, type Page } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect } from 'vitest'
import { test as adminTest } from '../admin-scope.ts'
import { page, section, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
const cmsHost = useCmsHost()
const test = adminTest.extend<{ host: typeof cmsHost }>({
  host: async ({ scope }, use) => use(scope.host(cmsHost)),
})

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const input = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const stored = async (host: typeof cmsHost, id: string) =>
  (await host.call<Page>('GET', `/pages/${id}`)).body

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

test('pages list system pages; an editor edits the draft in generated forms and publishes', async ({
  host,
  scope,
}) => {
  const created = (
    await host.create(
      page({ en: '/about', it: '/chi-siamo' }, [section('hero', { tone: 'light' })]),
    )
  ).body
  const text = scope.mount('/admin/cms/pages', { fetch: host.fetch })
  await scope.poll(text).toContain('Domovská stránka')
  expect(text()).toContain('Systémová stránka')
  expect(document.querySelector('nav')?.textContent).toContain('Stránky')

  history.replaceState(null, '', `/admin/cms/pages/${created.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await scope.poll(() => input('sections.0.title.en')).toBeTruthy()
  // Localized fields get one tab per content locale; the custom widget is the host's.
  expect(input('sections.0.title.it')).toBeTruthy()
  await scope.poll(() => document.querySelector('input[type="color"]')).toBeTruthy()
  expect(text()).toContain('Farba zvýraznenia')

  type('sections.0.title.en', 'About us')
  type('locales.en.seo.title', 'About')
  button('Uložiť koncept')!.click()
  await scope.poll(text).toContain('Koncept uložený.')
  const draft = await stored(host, created.id)
  expect(draft.draft.sections[0]?.data).toEqual({ title: { en: 'About us' }, tone: 'light' })
  expect(draft.draft.locales.en?.seo.title).toBe('About')
  expect(draft.status).toBe('draft')

  button('Zverejniť')!.click()
  await scope.poll(text).toContain('Zverejnené.')
  expect((await stored(host, created.id)).status).toBe('published')
  expect(button('Zrušiť zverejnenie')).toBeDefined()
  // An editor's own page can be deleted; system pages offer no delete.
  expect(button('Vymazať')).toBeDefined()
})

test('a system page offers no delete', async ({ host, scope }) => {
  const { body } = await host.call<{ rows: Array<{ id: string; systemKey: string | null }> }>(
    'GET',
    '/pages',
  )
  const home = body.rows.find((r) => r.systemKey === 'home')!
  const text = scope.mount(`/admin/cms/pages/${home.id}`, { fetch: host.fetch })
  await scope.poll(text).toContain('Uložiť koncept')
  expect(button('Vymazať')).toBeUndefined()
  await scope.poll(text).toContain('Zatiaľ žiadne publikované revízie.')
})
