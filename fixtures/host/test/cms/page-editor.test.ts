import type { Page, PagePreview } from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect, onTestFinished, test, vi } from 'vitest'
import { adminModules } from '../../admin/modules.ts'
import { definitions } from '../../cms/definitions.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, section, useCmsHost } from './helpers.ts'

const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const mountAdmin = (path: string, modules = adminModules) =>
  admin.mount(path, { fetch: host.fetch, modules })

const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  )
const input = (name: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const shown = (name: string) => input(name)?.checkVisibility() === true
const region = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('nav, section')].find(
    (el) =>
      document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ===
      label,
  )
const outline = () => region('Osnova stránky')!
const item = (index: number) => outline().querySelectorAll('ol > li')[index]!
const selectItem = (index: number) => item(index).querySelector('button')!.click()
const inputsHeading = () =>
  document.getElementById(
    [...document.querySelectorAll('form section')].at(-1)!.getAttribute('aria-labelledby')!,
  )?.textContent
const frame = () => document.querySelector('iframe')
const focused = () => document.activeElement?.getAttribute('name')

const listen = () => vi.spyOn(frame()!.contentWindow!, 'postMessage').mockImplementation(() => {})
const previews = (posted: ReturnType<typeof listen>) =>
  posted.mock.calls.flatMap(([message, origin]) =>
    typeof message === 'object' && message !== null && 'preview' in message
      ? [{ message: message as { type: string; preview: PagePreview }, origin }]
      : [],
  )
const lastPreview = (posted: ReturnType<typeof listen>) => previews(posted).at(-1)?.message.preview
const fromFrame = (
  data: unknown,
  {
    origin = location.origin,
    source = frame()!.contentWindow,
  }: { origin?: string; source?: MessageEventSource | null } = {},
) => window.dispatchEvent(new window.MessageEvent('message', { data, origin, source }))
const ready = () => fromFrame({ type: 'opulon:cms:ready' })
const select = (sectionId: string, field?: string) =>
  fromFrame({ type: 'opulon:cms:select', sectionId, ...(field === undefined ? {} : { field }) })

const pick = async (root: ParentNode, option: string) => {
  root.querySelector<HTMLElement>('[aria-haspopup="listbox"]')!.click()
  const item = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => el.textContent?.trim() === option,
    )
  await expect.poll(item).toBeDefined()
  item()!.click()
}
const stored = async (id: string) => (await host.call<Page>('GET', `/pages/${id}`)).body
const serverPreview = async (id: string, locale: string) =>
  (await host.call<PagePreview>('GET', `/pages/${id}/preview?locale=${locale}`)).body

const twoHeroes = async () =>
  (
    await host.create(
      page({ en: `/editor-${crypto.randomUUID()}`, it: `/editore-${crypto.randomUUID()}` }, [
        section('hero', { title: { en: 'First', it: 'Primo' }, tone: 'light' }),
        section('stats', { count: 3, note: 'Second' }),
      ]),
    )
  ).body

test('the editor shows outline, preview and inputs; the first section is selected', async () => {
  const created = await twoHeroes()
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()

  expect(outline().tagName).toBe('NAV')
  expect(region('Náhľad')?.querySelector('iframe')?.title).toBe('Živý náhľad stránky')
  expect(frame()!.src).toBe(`${location.origin}/site/?preview=${created.id}&locale=en`)
  expect(inputsHeading()).toBe('1. Úvodný blok')
  expect(shown('sections.0.title.en')).toBe(true)
  expect(shown('sections.1.note')).toBe(false)
  expect(shown('locales.en.path')).toBe(false)
  expect(outline().querySelector('[aria-current="true"]')?.textContent).toContain('1. Úvodný blok')
  expect(outline().textContent).toContain('First')
})

test('a page without sections opens on its settings', async () => {
  const created = (await host.create(page({ en: `/bare-${crypto.randomUUID()}` }))).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  expect(shown('locales.en.path')).toBe(true)
  expect(inputsHeading()).toBe('Nastavenia stránky')
})

test('the frame gets the unsaved draft after it is ready, debounced, and nothing is saved', async () => {
  const created = await twoHeroes()
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => void vi.useRealTimers())

  type('sections.0.title.en', 'Before ready')
  await vi.advanceTimersByTimeAsync(1000)
  expect(posted.mock.calls).toEqual([])

  ready()
  expect(previews(posted)).toHaveLength(1)
  expect(previews(posted)[0]!.origin).toBe(location.origin)
  expect(previews(posted)[0]!.message.type).toBe('opulon:cms:preview')
  expect(lastPreview(posted)!.sections[0]!.data.title).toBe('Before ready')

  type('sections.0.title.en', '<b>Typed</b> live')
  await vi.advanceTimersByTimeAsync(100)
  expect(previews(posted)).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(50)
  expect(previews(posted)).toHaveLength(2)
  expect(lastPreview(posted)!.sections[0]!.data.title).toBe('<b>Typed</b> live')
  vi.useRealTimers()

  expect((await stored(created.id)).draft.sections[0]!.data).toEqual({
    title: { en: 'First', it: 'Primo' },
    tone: 'light',
  })
})

test('the live preview is the server preview, per preview language', async () => {
  const created = await twoHeroes()
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  ready()
  type('sections.0.title.en', 'Saved title')
  type('sections.1.note', 'Saved note')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  const saved = await serverPreview(created.id, 'en')
  expect(saved.sections[0]!.data.title).toBe('Saved title')
  await expect.poll(() => lastPreview(posted)).toEqual(saved)

  const english = frame()
  await pick(region('Náhľad')!, 'Taliančina')
  await expect
    .poll(() => frame()?.src)
    .toBe(`${location.origin}/site/?preview=${created.id}&locale=it`)
  expect(frame()).not.toBe(english)
  const italian = listen()
  ready()
  const it = await serverPreview(created.id, 'it')
  expect(it.sections[0]!.data.title).toBe('Primo')
  await expect.poll(() => lastPreview(italian)).toEqual(it)
})

test('stored rich text reaches the frame sanitized', async () => {
  const created = (
    await host.create(
      page({ en: `/rich-${crypto.randomUUID()}` }, [
        section('rich_text', {
          body: {
            en: '<p>Safe</p><script>alert(1)</script><p>a<img src="x" onerror="alert(1)"></p>',
          },
        }),
      ]),
    )
  ).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(frame).toBeTruthy()
  const posted = listen()
  ready()
  expect(lastPreview(posted)!.sections[0]!.data.body).toBe('<p>Safe</p><p>a</p>')
})

test('a click in the frame selects the section and focuses its field; others are ignored', async () => {
  const created = await twoHeroes()
  const [hero, stats] = created.draft.sections
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()

  select(stats!.id, 'note')
  await expect.poll(focused).toBe('sections.1.note')
  expect(inputsHeading()).toBe('2. Stats')

  select(hero!.id)
  await expect.poll(focused).toBe('sections.0.title.en')
  expect(inputsHeading()).toBe('1. Úvodný blok')

  select(stats!.id, 'note')
  await expect.poll(focused).toBe('sections.1.note')
  select(hero!.id, 'constructor')
  await expect.poll(focused).toBe('sections.0.title.en')

  const rejected: Array<() => void> = [
    () => select(crypto.randomUUID(), 'note'),
    () =>
      fromFrame(
        { type: 'opulon:cms:select', sectionId: hero!.id, field: 'title' },
        { origin: 'https://evil.test' },
      ),
    () =>
      fromFrame(
        { type: 'opulon:cms:select', sectionId: hero!.id, field: 'title' },
        { source: window },
      ),
  ]
  for (const reject of rejected) {
    select(stats!.id, 'note')
    reject()
    await expect.poll(focused).toBe('sections.1.note')
    expect(inputsHeading()).toBe('2. Stats')
    select(hero!.id, 'title')
    await expect.poll(focused).toBe('sections.0.title.en')
  }
})

test('the outline selects, moves, removes and adds sections', async () => {
  const created = await twoHeroes()
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()

  button('Nastavenia stránky', outline())!.click()
  await expect.poll(() => shown('locales.en.path')).toBe(true)
  expect(shown('sections.0.title.en')).toBe(false)
  expect(outline().querySelector('[aria-current="true"]')?.textContent).toContain(
    'Nastavenia stránky',
  )

  selectItem(0)
  await expect.poll(inputsHeading).toBe('1. Úvodný blok')
  button('Posunúť nižšie', item(0))!.click()
  await expect.poll(inputsHeading).toBe('2. Úvodný blok')
  expect(shown('sections.1.title.en')).toBe(true)
  expect(input('sections.1.title.en')!.value).toBe('First')
  expect(button('Posunúť nižšie', item(1))!.disabled).toBe(true)
  expect(button('Posunúť vyššie', item(0))!.disabled).toBe(true)

  await pick(outline(), 'Úvodný blok')
  button('Pridať sekciu', outline())!.click()
  await expect.poll(inputsHeading).toBe('3. Úvodný blok')
  expect(shown('sections.2.title.en')).toBe(true)

  selectItem(1)
  await expect.poll(inputsHeading).toBe('2. Úvodný blok')
  button('Odstrániť sekciu', item(1))!.click()
  await expect.poll(() => outline().querySelectorAll('ol > li').length).toBe(2)
  expect(inputsHeading()).toBe('2. Úvodný blok')
  expect(shown('sections.1.title.en')).toBe(true)
  expect(input('sections.1.title.en')!.value).toBe('')
})

test('a click on rich text in the frame focuses its editor, not its toolbar', async () => {
  const created = (
    await host.create(
      page({ en: `/rich-focus-${crypto.randomUUID()}` }, [
        section('hero', { title: { en: 'Top' } }),
        section('rich_text', { body: { en: '<p>Body</p>' } }),
      ]),
    )
  ).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => document.querySelector('[contenteditable="true"]')).toBeTruthy()

  select(created.draft.sections[1]!.id, 'body')
  await expect.poll(inputsHeading).toBe('2. Formátovaný text')
  await expect.poll(() => document.activeElement?.getAttribute('contenteditable')).toBe('true')
})

test('a preview URL without the language still gets the chosen language', async () => {
  const created = await twoHeroes()
  const modules = adminModules.map((m) =>
    m.id === 'cms'
      ? cmsAdmin({
          definitions,
          widgets: { color: () => import('../../cms/ColorWidget.vue') },
          preview: { url: ({ id }) => `/site/?preview=${id}` },
        })
      : m,
  )
  mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const shell = frame()
  const posted = listen()
  ready()
  await expect.poll(() => lastPreview(posted)?.locale).toBe('en')

  await pick(region('Náhľad')!, 'Taliančina')
  const italian = await serverPreview(created.id, 'it')
  await expect.poll(() => lastPreview(posted)).toEqual(italian)
  expect(frame()).toBe(shell)
})

test('without a preview the editor has two panes', async () => {
  const created = await twoHeroes()
  const modules = adminModules.map((m) =>
    m.id === 'cms'
      ? cmsAdmin({ definitions, widgets: { color: () => import('../../cms/ColorWidget.vue') } })
      : m,
  )
  mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  expect(frame()).toBeNull()
  expect(region('Náhľad')).toBeUndefined()

  selectItem(1)
  await expect.poll(inputsHeading).toBe('2. Stats')
  expect(shown('sections.1.note')).toBe(true)
  expect(shown('sections.0.title.en')).toBe(false)
})
