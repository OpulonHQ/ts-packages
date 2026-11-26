import type { Page, PagePreview } from '@opulonjs/cms/api'
import { cmsAdmin, type CmsAdminOptions } from '@opulonjs/cms/admin'
import { defineComponent, h, nextTick } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import { adminModules, cmsOptions } from '../../admin/modules.ts'
import { files } from '../media/helpers.ts'
import { definitions } from '../../cms/definitions.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import {
  chooseLanguage,
  chosenLanguage,
  page,
  saveDraft,
  section,
  shown,
  useCmsHost,
} from './helpers.ts'

const admin = useAdminLifetime()
const host = admin.track(useCmsHost())

const mountAdmin = (path: string, modules = adminModules) =>
  admin.mount(path, { fetch: host.fetch, modules })
const withCms = (options: Partial<CmsAdminOptions>) =>
  adminModules.map((m) => (m.id === 'cms' ? cmsAdmin({ ...cmsOptions, ...options }) : m))

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

const heroAndCards = async () =>
  (
    await host.create(
      page({ en: `/cards-${crypto.randomUUID()}` }, [
        section('hero', { title: { en: 'First' }, tone: 'light' }),
        section('cards', { cards: [{ id: crypto.randomUUID(), data: { title: { en: 'Card' } } }] }),
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
  await vi.waitFor(() => expect(previews(posted)).toHaveLength(1))
  expect(previews(posted)[0]!.origin).toBe(location.origin)
  expect(previews(posted)[0]!.message.type).toBe('opulon:cms:preview')
  expect(lastPreview(posted)!.sections[0]!.data.title).toBe('Before ready')

  type('sections.0.title.en', '<b>Typed</b> live')
  await vi.advanceTimersByTimeAsync(100)
  expect(previews(posted)).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(50)
  await vi.waitFor(() => expect(previews(posted)).toHaveLength(2))
  expect(lastPreview(posted)!.sections[0]!.data.title).toBe('<b>Typed</b> live')
  vi.useRealTimers()

  expect((await stored(created.id)).draft.sections[0]!.data).toEqual({
    title: { en: 'First', it: 'Primo' },
    tone: 'light',
  })
})

test('an answer an edit has superseded never reaches the frame', async () => {
  const created = await twoHeroes()
  const release = Promise.withResolvers<void>()
  const answered = Promise.withResolvers<void>()
  let requests = 0
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/preview'))
      return host.fetch(request)
    if (++requests !== 1) return host.fetch(request)
    const answer = await host.fetch(request)
    answered.resolve()
    await release.promise
    return answer
  }
  admin.mount(`/admin/cms/pages/${created.id}`, { fetch, modules: adminModules })
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  ready()
  await answered.promise

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => void vi.useRealTimers())
  type('sections.0.title.en', 'Newer draft')
  await nextTick()
  release.resolve()
  await vi.advanceTimersByTimeAsync(100)
  expect(previews(posted)).toEqual([])

  await vi.advanceTimersByTimeAsync(50)
  await vi.waitFor(() => expect(previews(posted)).toHaveLength(1))
  expect(lastPreview(posted)!.sections[0]!.data.title).toBe('Newer draft')
})

test('the live preview is the server preview, per preview language', async () => {
  const created = await twoHeroes()
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  ready()
  type('sections.0.title.en', 'Saved title')
  type('sections.1.note', 'Saved note')
  await saveDraft()
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

test('rich text a custom widget types reaches the frame sanitized, as the server stores it', async () => {
  const created = (
    await host.create(
      page({ en: `/raw-${crypto.randomUUID()}`, it: `/grezzo-${crypto.randomUUID()}` }, [
        section('rich_text', { body: { en: '<p>Safe</p>' } }),
      ]),
    )
  ).body
  const RawHtml = defineComponent({
    props: { name: { type: String, required: true } },
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        h('textarea', {
          name: props.name,
          onInput: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLTextAreaElement).value),
        }),
  })
  const body = definitions.sections.rich_text.fields.body
  const rawDefinitions = {
    ...definitions,
    sections: {
      ...definitions.sections,
      rich_text: {
        ...definitions.sections.rich_text,
        fields: { body: { ...body, widget: 'raw' } },
      },
    },
  }
  const modules = withCms({
    definitions: rawDefinitions,
    widgets: { ...cmsOptions.widgets, raw: async () => ({ default: RawHtml }) },
  })
  const text = mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.0.body.en')).toBeTruthy()
  const posted = listen()
  ready()

  const hostile = '<p>Hi<img src="x" onerror="alert(1)"></p><script>alert(2)</script>'
  type('sections.0.body.en', hostile)
  await expect.poll(() => lastPreview(posted)?.sections[0]?.data.body).toBe('<p>Hi</p>')
  const live = lastPreview(posted)

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  expect(live).toEqual(await serverPreview(created.id, 'en'))
})

test.each([
  [
    'a malformed link from a custom widget does not stop the live preview',
    { type: 'url' },
    { more: { type: 'url' } },
  ],
  [
    'a script URL link from a custom widget never reaches the frame',
    { type: 'url', url: ' javascript:alert(1)' },
    {},
  ],
])('%s', async (_, link, expected) => {
  const created = await heroAndCards()
  const Broken = defineComponent({
    props: { name: { type: String, required: true } },
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        h('textarea', {
          name: props.name,
          onInput: () => emit('update:modelValue', link),
        }),
  })
  const cards = definitions.sections.cards
  const more = { ...cards.fields.more, widget: 'broken' }
  const modules = withCms({
    definitions: {
      ...definitions,
      sections: { ...definitions.sections, cards: { ...cards, fields: { ...cards.fields, more } } },
    },
    widgets: { ...cmsOptions.widgets, broken: async () => ({ default: Broken }) },
  })
  mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.1.more')).toBeTruthy()
  const posted = listen()
  ready()

  type('sections.1.more', 'x')
  type('sections.0.title.en', 'After the link')
  await expect
    .poll(() => lastPreview(posted)?.sections.map((s) => s.data))
    .toEqual([
      { title: 'After the link', tone: 'light' },
      { cards: [{ id: expect.any(String), data: { title: 'Card' } }], ...expected },
    ])
})

test('an unsaved media or link edit reaches the frame resolved, as the Read API gives it', async () => {
  const lake = await host.upload(files.png(800, 600), 'lake.png', { en: 'A lake' })
  const target = (await host.create(page({ en: `/target-${crypto.randomUUID()}` }))).body
  expect((await host.publish(target.id)).status).toBe(200)
  const created = await heroAndCards()
  const emitting = (value: unknown) =>
    defineComponent({
      props: { name: { type: String, required: true } },
      emits: ['update:modelValue'],
      setup:
        (props, { emit }) =>
        () =>
          h('textarea', { name: props.name, onInput: () => emit('update:modelValue', value) }),
    })
  const { hero, cards } = definitions.sections
  const modules = withCms({
    definitions: {
      ...definitions,
      sections: {
        ...definitions.sections,
        hero: {
          ...hero,
          fields: { ...hero.fields, image: { ...hero.fields.image, widget: 'pickImage' } },
        },
        cards: {
          ...cards,
          fields: { ...cards.fields, more: { ...cards.fields.more, widget: 'pickLink' } },
        },
      },
    },
    widgets: {
      ...cmsOptions.widgets,
      pickImage: async () => ({ default: emitting(lake) }),
      pickLink: async () => ({ default: emitting({ type: 'page', id: target.id }) }),
    },
  })
  mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.1.more')).toBeTruthy()
  const posted = listen()
  ready()

  type('sections.0.image', 'x')
  type('sections.1.more', 'x')
  await expect
    .poll(() => lastPreview(posted)?.sections.map((s) => s.data))
    .toMatchObject([
      { image: { id: lake, url: `/media/${lake}/1/lake.png`, alt: 'A lake' } },
      { more: { type: 'page', id: target.id, href: target.draft.locales.en!.path } },
    ])
  expect((await stored(created.id)).draft).toEqual(created.draft)
})

test('the pane says so when the server cannot render the draft, and recovers', async () => {
  const created = await twoHeroes()
  let refuse = true
  const fetch: typeof host.fetch = (input, init) => {
    const request = new Request(input, init)
    return refuse && request.method === 'POST' && new URL(request.url).pathname.endsWith('/preview')
      ? Promise.resolve(new Response(null, { status: 503 }))
      : host.fetch(request)
  }
  const text = admin.mount(`/admin/cms/pages/${created.id}`, { fetch, modules: adminModules })
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  ready()
  await expect.poll(text).toContain('Náhľad sa nepodarilo aktualizovať.')
  expect(previews(posted)).toEqual([])

  refuse = false
  type('sections.0.title.en', 'Back')
  await expect.poll(() => lastPreview(posted)?.sections[0]?.data.title).toBe('Back')
  expect(text()).not.toContain('Náhľad sa nepodarilo aktualizovať.')
})

test('the live preview is the draft as Save stores it', async () => {
  const created = await twoHeroes()
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  const posted = listen()
  ready()

  type('sections.1.note', '')
  type('locales.en.seo.title', '  Padded title  ')
  type('locales.en.seo.description', ` ${'d'.repeat(1200)} `)
  await expect.poll(() => lastPreview(posted)?.seo.description.length).toBe(1000)
  const live = lastPreview(posted)
  expect(live!.seo.title).toBe('Padded title')
  expect(live!.sections[1]!.data).toEqual({ count: 3 })

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  expect(live).toEqual(await serverPreview(created.id, 'en'))
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

test('a click in the Italian preview edits and saves the Italian text', async () => {
  const created = await twoHeroes()
  const [hero] = created.draft.sections
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  await pick(region('Náhľad')!, 'Taliančina')
  await expect.poll(() => frame()?.src).toContain('locale=it')

  // The closing language list hands focus back after a tick; click until focus stays.
  await expect.poll(() => (select(hero!.id, 'title'), focused())).toBe('sections.0.title.it')
  const typing = document.activeElement as HTMLInputElement
  typing.value = 'Titolo dal riquadro'
  typing.dispatchEvent(new Event('input'))

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  expect((await stored(created.id)).draft.sections[0]!.data.title).toEqual({
    en: 'First',
    it: 'Titolo dal riquadro',
  })
})

test('a click in the Italian preview turns the whole editor to Italian, and its switch turns the preview', async () => {
  const created = await twoHeroes()
  const [hero] = created.draft.sections
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  await pick(region('Náhľad')!, 'Taliančina')
  await expect.poll(() => (select(hero!.id, 'title'), focused())).toBe('sections.0.title.it')

  button('Nastavenia stránky', outline())!.click()
  await expect.poll(() => shown('locales.it.path')).toBe(true)
  expect(shown('locales.en.path')).toBe(false)
  expect(chosenLanguage()).toBe('Taliančina')

  chooseLanguage('Angličtina')
  await expect
    .poll(() => frame()?.src)
    .toBe(`${location.origin}/site/?preview=${created.id}&locale=en`)
  expect(shown('locales.en.path')).toBe(true)
  expect(shown('locales.it.path')).toBe(false)
  expect(region('Náhľad')!.querySelector('[aria-haspopup="listbox"]')?.textContent?.trim()).toBe(
    'Angličtina',
  )
  selectItem(0)
  await expect.poll(() => shown('sections.0.title.en')).toBe(true)
  expect(shown('sections.0.title.it')).toBe(false)
})

test('Italian typed before switching back to English is kept, and Save stores both', async () => {
  const created = await twoHeroes()
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('sections.0.title.it')).toBe(true)
  expect(shown('sections.0.title.en')).toBe(false)
  type('sections.0.title.it', 'Titolo nuovo')
  chooseLanguage('Angličtina')
  await expect.poll(() => shown('sections.0.title.en')).toBe(true)
  expect(shown('sections.0.title.it')).toBe(false)
  type('sections.0.title.en', 'New title')
  expect(input('sections.0.title.it')!.value).toBe('Titolo nuovo')

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  expect((await stored(created.id)).draft.sections[0]!.data.title).toEqual({
    en: 'New title',
    it: 'Titolo nuovo',
  })
})

test('a save refused for an Italian value turns the editor to Italian', async () => {
  const created = await twoHeroes()
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  expect(chosenLanguage()).toBe('Angličtina')
  type('sections.0.title.it', 'x'.repeat(121))

  await saveDraft()
  await expect.poll(text).toContain('["title"]["it"]')
  expect(chosenLanguage()).toBe('Taliančina')
  expect(shown('sections.0.title.it')).toBe(true)
  expect(shown('sections.0.title.en')).toBe(false)
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

test('a click on a select or a switch in the frame focuses its control', async () => {
  const created = await twoHeroes()
  const [hero, stats] = created.draft.sections
  mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()

  select(hero!.id, 'tone')
  await expect.poll(() => document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox')
  expect(document.activeElement?.closest('[data-field]')?.getAttribute('data-field')).toBe('tone')

  select(stats!.id, 'visible')
  await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('switch')
  expect(document.activeElement?.closest('[data-field]')?.getAttribute('data-field')).toBe(
    'visible',
  )
})

test('a preview URL without the language still gets the chosen language', async () => {
  const created = await twoHeroes()
  const modules = withCms({ preview: { url: ({ id }) => `/site/?preview=${id}` } })
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
  const modules = withCms({ preview: undefined })
  mountAdmin(`/admin/cms/pages/${created.id}`, modules)
  await expect.poll(() => input('sections.0.title.en')).toBeTruthy()
  expect(frame()).toBeNull()
  expect(region('Náhľad')).toBeUndefined()

  selectItem(1)
  await expect.poll(inputsHeading).toBe('2. Stats')
  expect(shown('sections.1.note')).toBe(true)
  expect(shown('sections.0.title.en')).toBe(false)
})

test('every section has a Hide on the site switch; hiding marks the outline and saves, showing again leaves nothing unsaved', async () => {
  const created = (
    await host.create(
      page({ en: `/hide-${crypto.randomUUID()}` }, [
        section('hero', { title: { en: 'First' } }),
        section('stats', { note: 'Second' }),
        section('cards', { cards: [{ id: crypto.randomUUID(), data: { title: { en: 'Card' } } }] }),
      ]),
    )
  ).body
  mountAdmin(`/admin/cms/pages/${created.id}`)
  const bar = () => document.querySelector('[role="region"][aria-label="Neuložené zmeny"]')
  const hideSwitches = () =>
    [...document.querySelectorAll<HTMLElement>('button[role="switch"]')].filter(
      (el) => document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() === 'Skryť na webe',
    )
  await expect.poll(() => hideSwitches().length).toBe(3)
  expect(outline().textContent).not.toContain('Skrytá')

  selectItem(1)
  hideSwitches()[1]!.click()
  await expect.poll(() => item(1).textContent).toContain('Skrytá')
  expect(item(0).textContent).not.toContain('Skrytá')
  await expect.poll(bar).toBeTruthy()

  hideSwitches()[1]!.click()
  await expect.poll(() => item(1).textContent).not.toContain('Skrytá')
  await expect.poll(bar).toBeNull()

  hideSwitches()[1]!.click()
  await saveDraft()
  await expect.poll(async () => (await stored(created.id)).draft.sections[1]?.hidden).toBe(true)
  const sections = (await stored(created.id)).draft.sections
  expect(sections[0]).not.toHaveProperty('hidden')
  expect(sections[2]).not.toHaveProperty('hidden')
})
