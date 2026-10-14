import { defineCms, fields, type Page } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect, test } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, section, useCmsHost } from './helpers.ts'

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
  button('Uložiť koncept')!.click()
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

test('a system page offers no delete', async () => {
  const { body } = await host.call<{ rows: Array<{ id: string; systemKey: string | null }> }>(
    'GET',
    '/pages',
  )
  const home = body.rows.find((r) => r.systemKey === 'home')!
  const text = mountAdmin(`/admin/cms/pages/${home.id}`)
  await expect.poll(text).toContain('Uložiť koncept')
  expect(button('Vymazať')).toBeUndefined()
  await expect.poll(text).toContain('Zatiaľ žiadne publikované revízie.')
})
