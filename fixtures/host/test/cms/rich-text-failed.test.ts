import type { Item } from '@opulonjs/cms/api'
import { expect, test, vi } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { useCmsHost } from './helpers.ts'

vi.mock('@opulonjs/ui/components/Field/RichText', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

test('a rich text editor that fails to load says so and offers a reload; the rest of the form stays', async () => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Unreachable editor' } } },
    })
  ).body
  const text = admin.mount(`/admin/cms/items/${created.id}`, { fetch: host.fetch })
  await expect.poll(text).toContain('Editor sa nepodarilo načítať.')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Editor sa nepodarilo načítať.',
  )
  expect([...document.querySelectorAll('button')].map((b) => b.textContent?.trim())).toContain(
    'Obnoviť stránku',
  )
  expect(document.querySelector<HTMLInputElement>('[name="data.title.en"]')?.value).toBe(
    'Unreachable editor',
  )
})
