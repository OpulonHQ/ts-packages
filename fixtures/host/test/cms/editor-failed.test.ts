import type { Item } from '@opulonjs/cms/api'
import { expect, test, vi } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, section, useCmsHost } from './helpers.ts'

vi.mock('@opulonjs/ui/components/RichTextControl', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})
vi.mock('../../cms/ColorWidget.vue', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})

const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const failedEditors = () =>
  [...document.querySelectorAll('[role="alert"]')].filter((alert) =>
    alert.textContent?.includes('Editor sa nepodarilo načítať.'),
  )
const reloadsOnClick = () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined)
  const button = [...failedEditors()[0]!.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Obnoviť stránku',
  )
  button?.click()
  const reloaded = reload.mock.calls.length
  reload.mockRestore()
  return reloaded
}

test('a rich text editor that fails to load says so and offers a reload; the rest of the form stays', async () => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Unreachable editor' } } },
    })
  ).body
  admin.mount(`/admin/cms/items/${created.id}`, { fetch: host.fetch })
  await expect.poll(() => failedEditors().length).toBeGreaterThan(0)
  expect(reloadsOnClick()).toBe(1)
  expect(document.querySelector<HTMLInputElement>('[name="data.title.en"]')?.value).toBe(
    'Unreachable editor',
  )
})

test('a registered cms widget that fails to load says so and offers a reload', async () => {
  const created = (await host.create(page({ en: '/unreachable-widget' }, [section('hero', {})])))
    .body
  admin.mount(`/admin/cms/pages/${created.id}`, { fetch: host.fetch })
  await expect.poll(() => failedEditors().length).toBeGreaterThan(0)
  expect(reloadsOnClick()).toBe(1)
  expect(document.querySelector('[name="sections.0.title.en"]')).toBeTruthy()
  expect(document.querySelector('input[type="color"]')).toBeNull()
})
