import type { Item, Page } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk: "Neuložené zmeny" is the bar, "Uložiť koncept" its Save.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
const mountAdmin = (path: string) => admin.mount(path, { fetch: host.fetch })

const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const bar = () => document.querySelector('[role="region"][aria-label="Neuložené zmeny"]')
const goTo = (path: string) => {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const storedPage = async (id: string) => (await host.call<Page>('GET', `/pages/${id}`)).body

test('a page missing a content locale opens without unsaved changes; an edit brings the bar', async () => {
  // Only English: the editor fills in an empty Italian locale, which is not a change.
  const created = (await host.create(page({ en: `/unsaved-${crypto.randomUUID()}` }))).body
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  // The revision list answers after the editor rendered its draft: a bar would show by now.
  await expect.poll(text).toContain('Zatiaľ žiadne publikované revízie.')
  expect(bar()).toBeNull()
  expect(button('Uložiť koncept')).toBeUndefined()

  type('locales.en.seo.title', 'Edited')
  await expect.poll(bar).toBeTruthy()
  button('Uložiť koncept', bar()!)!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  await expect.poll(bar).toBeNull()
  expect((await storedPage(created.id)).draft.locales.en?.seo.title).toBe('Edited')
})

test('Discard asks, then puts the saved values back without a request', async () => {
  const created = (await host.create(page({ en: `/discard-${crypto.randomUUID()}` }))).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  type('locales.en.seo.title', 'Thrown away')
  await expect.poll(bar).toBeTruthy()

  button('Zahodiť', bar()!)!.click()
  await expect.poll(dialog).toBeTruthy()
  expect(dialog()!.textContent).toContain('Zahodiť neuložené zmeny?')
  button('Pokračovať v úpravách', dialog()!)!.click()
  await expect.poll(dialog).toBeNull()
  expect(input('locales.en.seo.title')!.value).toBe('Thrown away')

  button('Zahodiť', bar()!)!.click()
  await expect.poll(dialog).toBeTruthy()
  button('Zahodiť zmeny', dialog()!)!.click()
  await expect.poll(() => input('locales.en.seo.title')!.value).toBe('')
  await expect.poll(bar).toBeNull()
  expect((await storedPage(created.id)).version).toBe(created.version)
})

test('leaving with unsaved changes asks once; Keep editing stays, Discard changes leaves', async () => {
  const created = (await host.create(page({ en: `/leave-${crypto.randomUUID()}` }))).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  type('locales.en.seo.title', 'Not saved')
  await expect.poll(bar).toBeTruthy()

  goTo('/admin/cms/pages')
  await expect.poll(dialog).toBeTruthy()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  button('Pokračovať v úpravách', dialog()!)!.click()
  await expect.poll(() => location.pathname).toBe(`/admin/cms/pages/${created.id}`)
  expect(input('locales.en.seo.title')!.value).toBe('Not saved')

  goTo('/admin/cms/pages')
  await expect.poll(dialog).toBeTruthy()
  button('Zahodiť zmeny', dialog()!)!.click()
  await expect.poll(() => location.pathname).toBe('/admin/cms/pages')
  await expect.poll(bar).toBeNull()
  expect((await storedPage(created.id)).draft.locales.en?.seo.title).toBe('')
})

test('without unsaved changes, leaving does not ask', async () => {
  const created = (await host.create(page({ en: `/clean-${crypto.randomUUID()}` }))).body
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  goTo('/admin/cms/pages')
  await expect.poll(() => location.pathname).toBe('/admin/cms/pages')
  await expect.poll(text).toContain('Nová stránka')
  expect(dialog()).toBeNull()
})

test('Cmd/Ctrl+S saves the draft while it has changes', async () => {
  const created = (await host.create(page({ en: `/shortcut-${crypto.randomUUID()}` }))).body
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  type('locales.en.seo.title', 'By keyboard')
  await expect.poll(bar).toBeTruthy()
  const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
  window.dispatchEvent(shortcut)
  expect(shortcut.defaultPrevented).toBe(true)
  await expect.poll(text).toContain('Koncept uložený.')
  expect((await storedPage(created.id)).draft.locales.en?.seo.title).toBe('By keyboard')
})

test('Unpublish asks first and keeps the edits on screen', async () => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Live post' } } },
    })
  ).body
  await host.call('POST', `/items/${created.id}/publish?version=${created.version}`)
  const text = mountAdmin(`/admin/cms/items/${created.id}`)
  await expect.poll(() => input('data.title.en')).toBeTruthy()
  type('data.title.en', 'Live post, edited')
  await expect.poll(bar).toBeTruthy()

  button('Zrušiť zverejnenie')!.click()
  await expect.poll(dialog).toBeTruthy()
  expect(dialog()!.textContent).toContain('Stiahnuť z webu?')
  button('Zrušiť zverejnenie', dialog()!)!.click()
  await expect.poll(text).toContain('Zverejnenie zrušené.')
  expect(input('data.title.en')!.value).toBe('Live post, edited')
  expect(bar()).toBeTruthy()
  const stored = (await host.call<Item>('GET', `/items/${created.id}`)).body
  expect(stored.published).toBeNull()
  expect((stored.draft.data.title as Record<string, string>).en).toBe('Live post')
})
