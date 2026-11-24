import type { Page, PagePreview } from '@opulonjs/cms/api'
import { expect, test, vi } from 'vitest'
import { adminModules } from '../../admin/modules.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, saveDraft, section, useCmsHost } from './helpers.ts'

const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const input = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  )
const titles = () =>
  [...document.querySelectorAll<HTMLInputElement>('[name^="sections.0.cards."][name$=".title.en"]')]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((field) => field.value)
const frame = () => document.querySelector('iframe')!
const listen = () => vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation(() => {})
const previewed = (posted: ReturnType<typeof listen>) => {
  const message: unknown = posted.mock.calls.at(-1)?.[0]
  const preview = (message as { preview?: PagePreview } | undefined)?.preview
  return (preview?.sections[0]?.data['cards'] ?? []) as Array<{ data: { title?: string } }>
}
const previewedTitles = (posted: ReturnType<typeof listen>) =>
  previewed(posted).map((item) => item.data.title)

test('an editor adds, reorders and removes list items, the live preview follows, and Save stores them', async () => {
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  const created = (
    await host.create(
      page({ en: `/list-${crypto.randomUUID()}` }, [
        section('cards', {
          cards: [
            { id: a, data: { title: { en: 'A' } } },
            { id: b, data: { title: { en: 'B' } } },
          ],
        }),
      ]),
    )
  ).body
  const text = admin.mount(`/admin/cms/pages/${created.id}`, {
    fetch: host.fetch,
    modules: adminModules,
  })
  await expect.poll(() => input('sections.0.cards.1.title.en')).toBeTruthy()
  expect(titles()).toEqual(['A', 'B'])
  const posted = listen()
  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: { type: 'opulon:cms:ready' },
      origin: location.origin,
      source: frame().contentWindow,
    }),
  )

  button('Pridať položku')!.click()
  await expect.poll(() => input('sections.0.cards.2.title.en')).toBeTruthy()
  expect(document.activeElement).toBe(input('sections.0.cards.2.title.en'))
  type('sections.0.cards.2.title.en', 'C')
  await expect.poll(() => previewedTitles(posted)).toEqual(['A', 'B', 'C'])

  button('Posunúť položku 3 vyššie')!.click()
  await expect.poll(titles).toEqual(['A', 'C', 'B'])
  expect(document.activeElement).toBe(button('Posunúť položku 2 vyššie'))
  await expect.poll(() => previewedTitles(posted)).toEqual(['A', 'C', 'B'])

  button('Posunúť položku 2 vyššie')!.click()
  await expect.poll(titles).toEqual(['C', 'A', 'B'])
  expect(button('Posunúť položku 1 vyššie')!.disabled).toBe(true)
  expect(document.activeElement).toBe(button('Posunúť položku 1 nižšie'))

  button('Odstrániť položku 2')!.click()
  await expect.poll(titles).toEqual(['C', 'B'])
  await expect.poll(() => previewedTitles(posted)).toEqual(['C', 'B'])

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  const stored = (await host.call<Page>('GET', `/pages/${created.id}`)).body
  expect(stored.draft.sections[0]!.data['cards']).toEqual([
    { id: expect.any(String), data: { title: { en: 'C' } } },
    { id: b, data: { title: { en: 'B' } } },
  ])

  button('Pridať položku')!.click()
  await expect.poll(() => titles().length).toBe(3)
  button('Pridať položku')!.click()
  await expect.poll(() => titles().length).toBe(4)
  expect(button('Pridať položku')!.disabled).toBe(true)
  expect(text()).toContain('Najviac položiek: 4.')
})
