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
/** What the control named `name` says next to its label (`aria-describedby`'s hint). */
const hint = (name: string) =>
  input(name)
    ?.getAttribute('aria-describedby')
    ?.split(' ')
    .filter((id) => id.endsWith('-hint'))
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .join(' ')
/** The text of the visible `[data-field]` wrapper of a field: its label and hint. */
const fieldText = (key: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-field="${key}"] > *`)]
    .filter((el) => el.checkVisibility())
    .map((el) => el.textContent)
    .join('')

const run = () => crypto.randomUUID()
const createPost = async () =>
  (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        locales: { en: locale(`/blog/hello-${run()}`), it: locale(`/blog/ciao-${run()}`) },
        data: { title: { en: 'Hello', it: 'Ciao' } },
      },
    })
  ).body

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

test('a localized label shows once and names its language; shared fields say "Všetky jazyky"', async () => {
  const post = await createPost()
  admin.mount(`/admin/cms/items/${post.id}`, { fetch: host.fetch })
  await expect.poll(() => input('data.title.en')).toBeTruthy()

  expect(visibleLabels('Nadpis')).toHaveLength(1)
  expect(hint('data.title.en')).toBe('Angličtina')
  expect(hint('locales.en.path')).toBe('Angličtina')
  // Cover (media) and Categories (reference) are one value for every language.
  expect(fieldText('cover')).toContain('Všetky jazyky')
  expect(fieldText('categories')).toContain('Všetky jazyky')
  expect(fieldText('title')).not.toContain('Všetky jazyky')

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('data.title.it')).toBe(true)
  expect(visibleLabels('Nadpis')).toHaveLength(1)
  expect(hint('data.title.it')).toBe('Taliančina')
  expect(fieldText('cover')).toContain('Všetky jazyky')
})

test('site settings: what is typed in Italian stays after switching back, and Save stores both', async () => {
  const text = admin.mount('/admin/cms/settings', { fetch: host.fetch })
  await expect.poll(() => input('data.siteName.en')).toBeTruthy()
  expect(hint('data.phone')).toBe('Všetky jazyky')
  expect(hint('data.siteName.en')).toBe('Angličtina')
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
  expect(hint('items.0.label.en')).toBe('Angličtina')

  chooseLanguage('Taliančina')
  await expect.poll(() => shown('items.0.label.it')).toBe(true)
  expect(shown('items.0.label.en')).toBe(false)
  expect(text()).toContain('Documenti')
  type('items.0.label.it', 'Documentazione')
  await saveDraft()
  await expect.poll(text).toContain('Koncept uložený.')
  const legend = document.querySelector('form fieldset fieldset legend')
  expect(legend?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Odkaz Všetky jazyky')
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
  const view = [...document.querySelectorAll('details')].at(-1)!.parentElement!
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
  expect(hint('data.title.en')).toBeFalsy()
  expect(text()).not.toContain('Všetky jazyky')
  expect(text()).not.toContain('Angličtina')
})
