import type { Item, Menu, SiteSettings } from '@opulonjs/cms/api'
import { composeServer } from '@opulonjs/core'
import { expect, test } from 'vitest'
import { server } from '../../server/opulon.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import {
  chooseLanguage,
  chosenLanguage,
  languages,
  languageSwitch,
  locale,
  saveDraft,
  shown,
  useCmsHost,
} from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk; the fixture host's content locales are en and it.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
const englishOnly = admin.track(
  useCmsHost(composeServer({ modules: server.modules, contentLocales: ['en'] })),
)

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
/** Visible labels, legends and label rows in the form that read exactly `text`. */
const visibleLabels = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('form label, form legend span, form p')].filter(
    (el) => el.textContent?.trim() === text && el.checkVisibility(),
  )
/** The elements `el`'s `aria-describedby` points at. */
const describedBy = (el: Element | null | undefined) =>
  (el?.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id))
/** `el`'s accessible description: the text of what `aria-describedby` points at. */
const description = (el: Element | null | undefined) =>
  describedBy(el)
    .map((target) => target?.textContent?.trim())
    .join(' ')
/** The hint describing the control named `name`, and whether it shows (`sr-only`: it does not). */
const hintOf = (name: string) => {
  const target = describedBy(input(name)).find((el) => el?.id.endsWith('-hint'))
  return target
    ? { text: target.textContent?.trim(), shown: !target.classList.contains('sr-only') }
    : undefined
}
/** The text of the visible `[data-field]` wrapper of a field, without screen-reader-only text. */
const fieldText = (key: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-field="${key}"] > *`)]
    .filter((el) => el.checkVisibility())
    .map((el) => {
      const copy = el.cloneNode(true) as HTMLElement
      for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove()
      return copy.textContent
    })
    .join('')
const goTo = (path: string) => {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
/** The revision view: the block that ends with the snapshot's JSON. */
const revisionView = () => [...document.querySelectorAll('details')].at(-1)?.parentElement

const run = () => crypto.randomUUID()
const createPost = async (title: Record<string, string> = { en: 'Hello', it: 'Ciao' }) =>
  (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        locales: { en: locale(`/blog/hello-${run()}`), it: locale(`/blog/ciao-${run()}`) },
        data: { title },
      },
    })
  ).body
const storedItem = async (id: string) => (await host.call<Item>('GET', `/items/${id}`)).body

test('one switch shows every localized field and the path and SEO in the other language', async () => {
  const post = await createPost()
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.en')).toBeTruthy()

  expect(languages()).toEqual(['Angličtina', 'Taliančina'])
  expect(chosenLanguage()).toBe('Angličtina')
  expect(shown('data.title.en')).toBe(true)
  expect(shown('locales.en.path')).toBe(true)
  expect(shown('data.title.it')).toBe(false)
  expect(shown('locales.it.path')).toBe(false)

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.title.it')).toBe(true)
  expect(input('data.title.it')!.value).toBe('Ciao')
  expect(shown('locales.it.path')).toBe(true)
  expect(input('locales.it.path')!.value).toBe(post.draft.locales.it?.path)
  expect(shown('locales.it.seo.title')).toBe(true)
  expect(shown('data.title.en')).toBe(false)
  expect(shown('locales.en.path')).toBe(false)
  expect(shown('locales.en.seo.title')).toBe(false)
  // The switch is a labelled group of radios, so the keyboard reaches and moves it.
  const radios = [...languageSwitch()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  expect(radios.map((radio) => radio.checked)).toEqual([false, true])
  expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
})

test('a localized label shows once and its language is only read out; shared fields say "Všetky jazyky"', async () => {
  const post = await createPost()
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.en')).toBeTruthy()

  expect(visibleLabels('Nadpis')).toHaveLength(1)
  // The switch shows the language; each localized control says it to screen readers only.
  expect(hintOf('data.title.en')).toEqual({ text: 'Angličtina', shown: false })
  expect(hintOf('locales.en.path')).toEqual({ text: 'Angličtina', shown: false })
  expect(fieldText('title')).not.toContain('Angličtina')
  // Cover (media) and Categories (reference) are one value for every language.
  expect(fieldText('cover')).toContain('Všetky jazyky')
  expect(fieldText('categories')).toContain('Všetky jazyky')
  expect(fieldText('title')).not.toContain('Všetky jazyky')

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.title.it')).toBe(true)
  expect(visibleLabels('Nadpis')).toHaveLength(1)
  expect(hintOf('data.title.it')).toEqual({ text: 'Taliančina', shown: false })
  expect(fieldText('cover')).toContain('Všetky jazyky')
})

test('a switch is named by its label alone and described by its language or "Všetky jazyky"', async () => {
  const created = (
    await host.call<{ id: string }>('POST', '/pages', {
      body: {
        locales: { en: locale(`/toggles-${run()}`) },
        sections: [{ id: run(), type: 'stats', data: { visible: true } }],
      },
    })
  ).body
  admin.mount(`/admin/cms/pages/${created.id}`, { fetch: host.fetch })
  const toggle = (root: string) =>
    document.querySelector<HTMLElement>(`${root} button[role="switch"]`)
  const labelOf = (el: HTMLElement | null) =>
    document.querySelector(`label[for="${el?.id}"]`)?.textContent?.trim()
  await expect.poll(() => toggle('[data-field="visible"]')).toBeTruthy()

  const visible = toggle('[data-field="visible"]')
  expect(labelOf(visible)).toBe('Visible')
  expect(description(visible)).toBe('Všetky jazyky')
  expect(describedBy(visible)[0]?.classList.contains('sr-only')).toBe(false)
  // Page settings, English first: the first "Dostupná v tomto jazyku" is the English one.
  const available = [...document.querySelectorAll<HTMLElement>('button[role="switch"]')].find(
    (el) => labelOf(el) === 'Dostupná v tomto jazyku',
  )
  expect(available).toBeDefined()
  expect(description(available)).toBe('Angličtina')
  expect(describedBy(available)[0]?.classList.contains('sr-only')).toBe(true)
})

test('site settings: what is typed in Italian stays after switching back, and Save stores both', async () => {
  const text = admin.mount('/admin/cms/settings', { fetch: host.fetch })
  await expect.poll(() => input('data.siteName.en')).toBeTruthy()
  expect(hintOf('data.phone')).toEqual({ text: 'Všetky jazyky', shown: true })
  expect(hintOf('data.siteName.en')).toEqual({ text: 'Angličtina', shown: false })
  expect(visibleLabels('Názov webu')).toHaveLength(1)

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.siteName.it')).toBe(true)
  type('data.siteName.it', 'Esempio')
  // Shared by every language, so it stays in view.
  expect(shown('data.phone')).toBe(true)
  chooseLanguage('Angličtina')
  await expect.poll(() => shown('data.siteName.en')).toBe(true)
  expect(shown('data.siteName.it')).toBe(false)
  type('data.siteName.en', 'Example')

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  const settings = (await host.call<SiteSettings>('GET', '/settings')).body
  expect(settings.draft.data.siteName).toEqual({ en: 'Example', it: 'Esempio' })
})

test('menu entry labels follow the switch; the link is shared by every language', async () => {
  await host.saveDraft('/menus/footer', {
    items: [
      {
        id: crypto.randomUUID(),
        label: { en: 'Docs', it: 'Documenti' },
        link: { type: 'url', url: '/docs' },
        children: [],
      },
    ],
  })
  const text = admin.mount('/admin/cms/menus/footer', { fetch: host.fetch })
  await expect.poll(() => input('items.0.label.en')).toBeTruthy()
  expect(text()).toContain('Docs')
  expect(shown('items.0.label.it')).toBe(false)
  expect(hintOf('items.0.label.en')).toEqual({ text: 'Angličtina', shown: false })

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('items.0.label.it')).toBe(true)
  expect(shown('items.0.label.en')).toBe(false)
  expect(text()).toContain('Documenti')
  type('items.0.label.it', 'Documentazione')
  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  // The link's group is named "Odkaz" and described by "Všetky jazyky", shown on the same row.
  const link = document.querySelector('form fieldset fieldset')!
  const named = [...link.querySelector('legend')!.children].filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  )
  expect(named.map((el) => el.textContent?.trim())).toEqual(['Odkaz'])
  expect(description(link)).toBe('Všetky jazyky')
  expect((await host.call<Menu>('GET', '/menus/footer')).body.draft.items[0]?.label).toEqual({
    en: 'Docs',
    it: 'Documentazione',
  })
})

test('a revision shows the editor language, empty where its snapshot has none', async () => {
  const post = await createPost()
  const published = (await host.publishDraft<Item>(`/items/${post.id}`)).body
  // A snapshot from before Italian was a content locale.
  await host.query(
    `update cms.revision set document = document #- '{locales,it}'
     where id = '${published.publishedRevisionId}'`,
  )
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
  chooseLanguage('Taliančina')
  button('Zobraziť revíziu')!.click()

  await expect.poll(() => input('revision.locales.it.path')).toBeTruthy()
  const view = revisionView()!
  expect(chosenLanguage(view)).toBe('Taliančina')
  expect(shown('revision.locales.it.path')).toBe(true)
  expect(input('revision.locales.it.path')!.value).toBe('')
  expect(shown('revision.data.title.it')).toBe(true)
  expect(input('revision.data.title.it')!.value).toBe('Ciao')
  expect(shown('revision.locales.en.path')).toBe(false)

  chooseLanguage('Angličtina', view)
  await expect.poll(() => shown('revision.locales.en.path')).toBe(true)
  expect(input('revision.locales.en.path')!.value).toBe(post.draft.locales.en?.path)
  // One language for the editor and the revision it shows.
  expect(chosenLanguage()).toBe('Angličtina')
  expect(shown('locales.en.path')).toBe(true)
})

test('a host with one content locale shows no switch and no language next to labels', async () => {
  const post = (
    await englishOnly.call<Item>('POST', '/collections/posts/items', {
      body: { locales: { en: locale('/blog/solo') }, data: { title: { en: 'Solo' } } },
    })
  ).body
  const text = admin.mount(`/admin/cms/items/${post.id}`, { fetch: englishOnly.fetch })
  await expect.poll(() => input('data.title.en')).toBeTruthy()
  expect(shown('data.title.en')).toBe(true)
  expect(languageSwitch()).toBeUndefined()
  expect(document.querySelector('[role="radiogroup"]')).toBeNull()
  expect(visibleLabels('Nadpis')).toHaveLength(1)
  expect(hintOf('data.title.en')).toBeUndefined()
  expect(text()).not.toContain('Všetky jazyky')
  expect(text()).not.toContain('Angličtina')
})

test('a language only the snapshot holds is chosen in the revision alone; the editor keeps its own', async () => {
  const post = await createPost()
  const published = (await host.publishDraft<Item>(`/items/${post.id}`)).body
  // A snapshot from when French was a content locale.
  await host.query(
    `update cms.revision set document = jsonb_set(document, '{locales,fr}',
       '{"path": "/blog/salut", "available": true,
         "seo": {"title": "", "description": "", "image": null, "noindex": false}}')
     where id = '${published.publishedRevisionId}'`,
  )
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
  button('Zobraziť revíziu')!.click()
  await expect.poll(() => input('revision.locales.fr.path')).toBeTruthy()
  const view = revisionView()!
  expect(languages(view)).toEqual(['Angličtina', 'Taliančina', 'Francúzština'])

  chooseLanguage('Francúzština', view)
  await expect.poll(() => shown('revision.locales.fr.path')).toBe(true)
  expect(chosenLanguage(view)).toBe('Francúzština')
  expect(input('revision.locales.fr.path')!.value).toBe('/blog/salut')
  expect(chosenLanguage()).toBe('Angličtina')
  expect(shown('locales.en.path')).toBe(true)

  // The editor's switch still leads the revision.
  chooseLanguage('Taliančina')
  await expect.poll(() => chosenLanguage(view)).toBe('Taliančina')
  expect(shown('revision.locales.it.path')).toBe(true)
  expect(shown('locales.it.path')).toBe(true)
})

test('the language chosen in one editor is where the next one opens', async () => {
  const first = await createPost({ en: 'First', it: 'Primo' })
  const second = await createPost({ en: 'Second', it: 'Secondo' })
  admin.mount(`/admin/cms/items/${first.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.en')?.value).toBe('First')
  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.title.it')).toBe(true)

  goTo(`/admin/cms/items/${second.id}`)
  await expect.poll(() => input('data.title.it')?.value).toBe('Secondo')
  expect(chosenLanguage()).toBe('Taliančina')
  expect(shown('data.title.it')).toBe(true)
  expect(shown('locales.it.path')).toBe(true)

  goTo('/admin/cms/settings')
  await expect.poll(() => input('data.siteName.it')).toBeTruthy()
  expect(chosenLanguage()).toBe('Taliančina')
  expect(shown('data.siteName.it')).toBe(true)
})

test('a new admin, as after a reload, opens on the default language again', async () => {
  // The test before chose Italian in an admin built from the same modules.
  const post = await createPost()
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.en')).toBeTruthy()
  expect(chosenLanguage()).toBe('Angličtina')
  expect(shown('data.title.en')).toBe(true)
})

test('a publish refused for a missing English value turns an editor showing Italian to English', async () => {
  const post = await createPost({ it: 'Solo italiano' })
  const text = admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.it')).toBeTruthy()
  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.title.it')).toBe(true)

  button('Zverejniť')!.click()
  await expect.poll(text).toContain('"Title" is required in en.')
  expect(chosenLanguage()).toBe('Angličtina')
  expect(shown('data.title.en')).toBe(true)
  expect(shown('data.title.it')).toBe(false)
})

test('rich text typed in Italian survives switching to English, and Save stores both', async () => {
  type Tiptap = HTMLElement & { editor: { commands: { insertContent: (html: string) => boolean } } }
  const post = await createPost()
  const text = admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  // One rich text editor per language, in the order of the content locales.
  const body = (index: number) =>
    document.querySelectorAll('[data-field="body"] > div')[index]?.querySelector<Tiptap>('.tiptap')
  await expect.poll(() => body(1)?.editor).toBeTruthy()

  chooseLanguage('Taliančina')
  await expect.poll(() => body(1)?.checkVisibility()).toBe(true)
  expect(body(0)?.checkVisibility()).toBe(false)
  body(1)!.editor.commands.insertContent('Testo italiano')
  chooseLanguage('Angličtina')
  await expect.poll(() => body(0)?.checkVisibility()).toBe(true)
  body(0)!.editor.commands.insertContent('English text')

  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  expect((await storedItem(post.id)).draft.data.body).toEqual({
    en: '<p>English text</p>',
    it: '<p>Testo italiano</p>',
  })
})
