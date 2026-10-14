import { useI18n } from '@opulonjs/admin'
import {
  defineCms,
  fields,
  type Item,
  type Menu,
  type SiteSettings,
  type Page,
  type ItemRevision,
  type PageRevision,
  type CmsDefinitions,
} from '@opulonjs/cms/api'
import { cmsAdmin } from '@opulonjs/cms/admin'
import { expect, test } from 'vitest'
import { defineComponent, h, provide, reactive, ref, type VNode } from 'vue'
import { adminModules } from '../../admin/modules.ts'
import { definitions } from '../../cms/definitions.ts'
import RevisionView from '../../../../packages/cms/src/admin/RevisionView.vue'
import { cmsContextKey } from '../../../../packages/cms/src/admin/context.ts'
import type { RevisionSnapshot } from '../../../../packages/cms/src/admin/use-revisions.ts'
import { files } from '../media/helpers.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { page, section, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
const testScreen = (setup: () => () => VNode) => defineComponent({ setup })
type Document = Page | Item | SiteSettings | Menu
const menuLink = (label: string) => ({
  id: crypto.randomUUID(),
  label: { en: label },
  link: { type: 'url' as const, url: '/link' },
  children: [],
})
const editors = [
  {
    kind: 'page',
    open: async () =>
      `/pages/${(await host.create(page({ en: `/admin-conflict-${crypto.randomUUID()}` }))).body.id}`,
    field: 'locales.en.path',
    theirs: () => page({ en: '/admin-conflict-theirs' }),
    stored: (d: Document) => (d as Page).draft.locales.en?.path,
  },
  {
    kind: 'item',
    open: async () =>
      `/items/${
        (
          await host.call<Item>('POST', '/collections/posts/items', {
            body: { locales: {}, data: { title: { en: 'Mine' } } },
          })
        ).body.id
      }`,
    field: 'data.title.en',
    theirs: () => ({ locales: {}, data: { title: { en: 'Theirs' } } }),
    stored: (d: Document) => ((d as Item).draft.data.title as Record<string, string>).en,
  },
  {
    kind: 'settings',
    open: async () => '/settings',
    field: 'data.siteName.en',
    theirs: () => ({ data: { siteName: { en: 'Theirs' } } }),
    stored: (d: Document) => ((d as SiteSettings).draft.data.siteName as Record<string, string>).en,
  },
  {
    kind: 'menu',
    open: async () => {
      await host.saveDraft('/menus/footer', { items: [menuLink('Mine')] })
      return '/menus/footer'
    },
    field: 'items.0.label.en',
    theirs: () => ({ items: [menuLink('Theirs')] }),
    stored: (d: Document) => (d as Menu).draft.items[0]?.label.en,
  },
]

test.each(['item', 'page'])(
  'every %s revision JSON block preserves stored values after form rendering',
  async (kind) => {
    const snapshot: RevisionSnapshot =
      kind === 'item'
        ? await (async () => {
            const created = (
              await host.call<Item>('POST', '/collections/posts/items', {
                body: { locales: {}, data: { title: { en: 'Stored JSON item' } } },
              })
            ).body
            const published = (await host.publishDraft<Item>(`/items/${created.id}`)).body
            return {
              kind: 'item',
              revision: (
                await host.call<ItemRevision>(
                  'GET',
                  `/items/${created.id}/revisions/${published.publishedRevisionId}`,
                )
              ).body,
            }
          })()
        : await (async () => {
            const created = (
              await host.create(
                page({ en: '/stored-json-section' }, [
                  section('hero', { title: { en: 'Stored section title' } }),
                ]),
              )
            ).body
            const published = (await host.publish(created.id)).body
            return {
              kind: 'page',
              revision: (
                await host.call<PageRevision>(
                  'GET',
                  `/pages/${created.id}/revisions/${published.publishedRevisionId}`,
                )
              ).body,
            }
          })()
    const sections: Record<string, CmsDefinitions['sections'][string]> &
      Pick<CmsDefinitions['sections'], 'rich_text'> = { ...definitions.sections }
    const current = reactive({ ...definitions, sections })
    if (kind === 'page')
      current.sections.hero = {
        label: 'Hero',
        fields: {
          ...definitions.sections.hero?.fields,
          subtitle: fields.text({ label: 'New optional subtitle' }),
        },
      }
    const collection = ref<string | undefined>('posts')
    let fallback: (() => void) | undefined
    const modules = adminModules.map((module) =>
      module.id !== 'cms'
        ? module
        : {
            ...module,
            routes: module.routes?.map((route) =>
              route.name !== 'cms.item'
                ? route
                : {
                    ...route,
                    component: async () => ({
                      default: testScreen(() => {
                        provide(cmsContextKey, { definitions: current, widgets: {} })
                        const { locale } = useI18n()
                        fallback = () => {
                          collection.value = undefined
                          delete current.sections.hero
                          locale.value = 'en'
                        }
                        return () =>
                          h(RevisionView, {
                            snapshot,
                            documentRef: 'stored-json',
                            collection: collection.value,
                          })
                      }),
                    }),
                  },
            ),
          },
    )
    mountAdmin('/admin/cms/items/stored-json', host.fetch, modules)
    await expect
      .poll(() =>
        document.querySelector(
          `input[name="revision.${kind === 'item' ? 'data.title.en' : 'sections.0.subtitle.en'}"]`,
        ),
      )
      .toBeTruthy()
    fallback!()
    await expect.poll(() => document.querySelectorAll('pre').length).toBe(2)
    const blocks = [...document.querySelectorAll('pre')].map((block) =>
      JSON.parse(block.textContent!),
    )
    expect(blocks).toEqual([
      snapshot.kind === 'item'
        ? snapshot.revision.document.data
        : snapshot.revision.document.sections[0]?.data,
      snapshot.revision.document,
    ])
  },
)

test('read-only revision forms preserve the stored snapshot on rerender and restore by id', async () => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Stored revision title' } } },
    })
  ).body
  const first = (await host.publishDraft<Item>(`/items/${created.id}`)).body
  await host.saveDraft(`/items/${created.id}`, {
    locales: {},
    data: { title: { en: 'New draft title' } },
  })
  await host.publishDraft(`/items/${created.id}`)
  let rerender: (() => void) | undefined
  const modules = adminModules.map((module) =>
    module.id !== 'cms'
      ? module
      : {
          ...module,
          routes: module.routes?.map((route) =>
            route.name !== 'cms.item'
              ? route
              : {
                  ...route,
                  component: async () => {
                    const inner = await route.component()
                    return {
                      default: testScreen(() => {
                        const { locale } = useI18n()
                        rerender = () => {
                          locale.value = 'en'
                        }
                        return () => h(inner.default)
                      }),
                    }
                  },
                },
          ),
        },
  )
  let restoreBody: string | undefined
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).pathname.endsWith('/restore'))
      restoreBody = await request.clone().text()
    return host.fetch(request)
  }
  const text = mountAdmin(`/admin/cms/items/${created.id}`, fetch, modules)
  await expect
    .poll(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
          (button) => button.textContent?.trim() === 'Zobraziť revíziu',
        ).length,
    )
    .toBe(2)
  ;[...document.querySelectorAll<HTMLButtonElement>('tbody button')]
    .filter((b) => b.textContent?.trim() === 'Zobraziť revíziu')[1]!
    .click()
  await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  rerender!()
  await expect.poll(() => button('Restore to draft')).toBeTruthy()
  expect(JSON.parse(document.querySelector('details pre')!.textContent!)).toEqual(first.draft)
  button('Restore to draft')!.click()
  await expect.poll(text).toContain('This replaces the current draft')
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent?.trim() === 'Restore to draft')!
    .click()
  await expect.poll(text).toContain('Revision restored to draft.')
  expect(restoreBody).toBe('')
  const restored = (await host.call<Item>('GET', `/items/${created.id}`)).body
  expect(JSON.stringify(restored.draft)).toBe(JSON.stringify(first.draft))
})

test('a late page request cannot replace the editor after navigation', async () => {
  const a = (await host.create(page({ en: '/admin-race-a' }))).body
  const b = (await host.create(page({ en: '/admin-race-b' }))).body
  const held = admin.gate()
  let requested = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.url.endsWith(`/pages/${a.id}`)) {
      requested = true
      await held.promise
    }
    return response
  }
  const text = mountAdmin(`/admin/cms/pages/${a.id}`, fetch)
  await expect.poll(() => requested).toBe(true)
  history.pushState(null, '', `/admin/cms/pages/${b.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(text).toContain('/admin-race-b')
  held.resolve()
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(document.querySelector<HTMLInputElement>('input[name="locales.en.path"]')?.value).toBe(
    '/admin-race-b',
  )
})

test('revision history views a snapshot and restores it to the editor without publishing', async () => {
  const created = (await host.create(page({ en: '/admin-revision-old' }))).body
  const first = (await host.publish(created.id)).body
  await host.save(created.id, page({ en: '/admin-revision-new' }))
  const second = (await host.publish(created.id)).body
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(text).toContain('História revízií')
  await expect
    .poll(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
          (button) => button.textContent?.trim() === 'Zobraziť revíziu',
        ).length,
    )
    .toBe(2)
  const views = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
    (b) => b.textContent?.trim() === 'Zobraziť revíziu',
  )
  views[1]!.click()
  await expect
    .poll(() => document.querySelector('input[name="revision.locales.en.path"]'))
    .toBeTruthy()
  expect(
    document.querySelector<HTMLInputElement>('input[name="revision.locales.en.path"]')?.value,
  ).toBe('/admin-revision-old')
  button('Obnoviť do konceptu')!.click()
  await expect.poll(text).toContain('Nahradí aktuálny koncept')
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.trim() === 'Obnoviť do konceptu',
  )
  confirm!.click()
  await expect.poll(text).toContain('Revízia bola obnovená do konceptu.')
  await expect
    .poll(() => document.querySelector<HTMLInputElement>('input[name="locales.en.path"]')?.value)
    .toBe('/admin-revision-old')
  const stored = (await host.call<Page>('GET', `/pages/${created.id}`)).body
  expect(stored.draft).toEqual(first.draft)
  expect(stored.publishedRevisionId).toBe(second.publishedRevisionId)
  expect(stored.published).toEqual(second.published)
})

test('a restore over a draft another editor changed is refused and offers to reload', async () => {
  const created = (await host.create(page({ en: '/admin-restore-stale-old' }))).body
  await host.publish(created.id)
  await host.save(created.id, page({ en: '/admin-restore-stale-new' }))
  await host.publish(created.id)
  const text = mountAdmin(`/admin/cms/pages/${created.id}`)
  await expect.poll(() => input('locales.en.path')?.value).toBe('/admin-restore-stale-new')
  const theirs = (await host.save(created.id, page({ en: '/admin-restore-stale-theirs' }))).body
  await expect
    .poll(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
          (button) => button.textContent?.trim() === 'Zobraziť revíziu',
        ).length,
    )
    .toBe(2)
  ;[...document.querySelectorAll<HTMLButtonElement>('tbody button')]
    .filter((b) => b.textContent?.trim() === 'Zobraziť revíziu')[1]!
    .click()
  await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  button('Obnoviť do konceptu')!.click()
  await expect.poll(text).toContain('Nahradí aktuálny koncept')
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent?.trim() === 'Obnoviť do konceptu')!
    .click()
  await expect.poll(text).toContain('Tento koncept medzitým zmenil niekto iný.')
  expect((await host.call<Page>('GET', `/pages/${created.id}`)).body).toEqual(theirs)

  button('Načítať koncept')!.click()
  await expect.poll(() => input('locales.en.path')?.value).toBe('/admin-restore-stale-theirs')
  await expect.poll(text).not.toContain('Tento koncept medzitým zmenil niekto iný.')
})

test('view-only editors can inspect revisions and cannot restore', async () => {
  const created = (await host.create(page({ en: '/admin-revision-view-only' }))).body
  await host.publish(created.id)
  const text = mountAdmin(`/admin/cms/pages/${created.id}`, host.fetchAs(['cms.pages.view']))
  await expect.poll(text).toContain('História revízií')
  await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
  button('Zobraziť revíziu')!.click()
  await expect
    .poll(() => document.querySelector('input[name="revision.locales.en.path"]'))
    .toBeTruthy()
  expect(button('Obnoviť do konceptu')).toBeUndefined()
})

test.each([
  {
    kind: 'item',
    route: (id: string) => `/admin/cms/items/${id}`,
    path: (id: string) => `/items/${id}`,
    create: '/collections/posts/items',
    first: { locales: {}, data: { title: { en: 'Revision first item' } } },
    second: { locales: {}, data: { title: { en: 'Revision second item' } } },
  },
  {
    kind: 'settings',
    route: () => '/admin/cms/settings',
    path: () => '/settings',
    create: undefined,
    first: { data: { siteName: { en: 'Revision first site' } } },
    second: { data: { siteName: { en: 'Revision second site' } } },
  },
  {
    kind: 'menu',
    route: () => '/admin/cms/menus/footer',
    path: () => '/menus/footer',
    create: undefined,
    first: { items: [] },
    second: {
      items: [
        {
          id: crypto.randomUUID(),
          label: { en: 'Revision second menu' },
          link: { type: 'url', url: '/second' },
          children: [],
        },
      ],
    },
  },
])('$kind screen exposes history, view and restore with the normal editor', async (c) => {
  const id = c.create ? (await host.call<Item>('POST', c.create, { body: c.first })).body.id : ''
  const path = c.path(id)
  if (!c.create) await host.saveDraft(path, c.first)
  const first = (await host.publishDraft<Item | Menu | SiteSettings>(path)).body
  await host.saveDraft(path, c.second)
  const second = (await host.publishDraft<Item | Menu | SiteSettings>(path)).body
  const text = mountAdmin(c.route(id))
  await expect
    .poll(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
          (button) => button.textContent?.trim() === 'Zobraziť revíziu',
        ).length,
    )
    .toBeGreaterThanOrEqual(2)
  const views = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].filter(
    (b) => b.textContent?.trim() === 'Zobraziť revíziu',
  )
  views[1]!.click()
  await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  button('Obnoviť do konceptu')!.click()
  await expect.poll(text).toContain('Nahradí aktuálny koncept')
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent?.trim() === 'Obnoviť do konceptu')!
    .click()
  await expect.poll(text).toContain('Revízia bola obnovená do konceptu.')
  const stored = (await host.call<Item | Menu | SiteSettings>('GET', path)).body
  expect(stored.draft).toEqual(first.draft)
  expect(stored.published).toEqual(second.published)
})

const failed = admin.track(
  useCmsHost(undefined, async () => ({
    success: false,
    errors: [{ code: 1, message: 'private diagnostic' }],
  })),
)

let mediaPurgeRefused = false
const mediaOnly = admin.track(
  useCmsHost(undefined, async () => ({
    success: !mediaPurgeRefused,
    errors: mediaPurgeRefused ? [{ code: 1, message: 'private media diagnostic' }] : [],
  })),
)

test('a media-only editor sees one purge warning after edits, replacement, archive and closing details', async () => {
  mediaPurgeRefused = false
  await mediaOnly.upload(files.png(800, 600), 'media-only.png')
  const fetch = mediaOnly.fetchAs(['media.view', 'media.upload', 'media.archive'])
  const text = mountAdmin('/admin/media', fetch)
  const row = () =>
    [...document.querySelectorAll<HTMLElement>('tbody tr')].find((row) =>
      row.textContent?.includes('media-only.png'),
    )
  await expect.poll(row).toBeTruthy()
  row()!.click()
  await expect.poll(() => input('alt.en')).toBeTruthy()
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  mediaPurgeRefused = true
  type('alt.en', 'Media-only edit')
  button('Uložiť')!.click()
  await expect.poll(text).toContain('Uložené.')
  const warnings = () =>
    [...document.querySelectorAll('[role="status"]')].filter((notice) =>
      notice.textContent?.includes('Živý web môže zobrazovať predchádzajúcu verziu'),
    )
  await expect.poll(warnings).toHaveLength(1)
  expect(text()).not.toContain('private media diagnostic')

  const recover = async () => {
    mediaPurgeRefused = false
    await mediaOnly.query(
      "update core.cache_purge set next_attempt_at = now() - interval '1 second'",
    )
    await mediaOnly.sweep()
    button('Uložiť')!.click()
    await expect.poll(warnings).toHaveLength(0)
  }
  await recover()
  mediaPurgeRefused = true
  const replacement = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="file"]',
  )!
  Object.defineProperty(replacement, 'files', {
    value: [new File([files.png(40, 30).slice()], 'replacement.png', { type: 'image/png' })],
    configurable: true,
  })
  replacement.dispatchEvent(new Event('change'))
  await expect.poll(text).toContain('Súbor bol nahradený.')
  await expect.poll(warnings).toHaveLength(1)
  await recover()
  mediaPurgeRefused = true
  button('Archivovať')!.click()
  await expect.poll(text).toContain('stránky, ktoré ju už používajú')
  ;[...document.querySelectorAll('button')]
    .filter((button) => button.textContent?.trim() === 'Archivovať')
    .at(-1)!
    .click()
  await expect.poll(text).toContain('Archivované.')
  await expect.poll(warnings).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('button[data-slot="close"]')!.click()
  await expect.poll(() => input('alt.en')).toBeFalsy()
  await expect.poll(warnings).toHaveLength(1)
})

test('a media view-only editor does not see an unavailable purge status warning', async () => {
  await failed.upload(files.png(800, 600), 'view-only.png')
  const text = mountAdmin('/admin/media', failed.fetchAs(['media.view']))
  await expect.poll(text).toContain('view-only.png')
  expect(text()).not.toContain('Stav vymazania vyrovnávacej pamäte nie je dostupný')
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
})

function mountAdmin(path: string, fetch = host.fetch, modules = adminModules) {
  return admin.mount(path, { fetch, modules })
}

test('the composed admin shows an editor the real failed purge from a media edit', async () => {
  const id = await failed.upload(files.png(800, 600), 'notice.png')
  const changed = await failed.fetch(`https://host.test/api/media/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alt: { en: 'Edited alt' }, caption: { en: 'Edited caption' } }),
  })
  expect(changed.status).toBe(200)
  const text = mountAdmin('/admin/cms/pages', failed.fetch)
  await expect.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).toContain('vymazanie vyrovnávacej pamäte')
  expect(text()).not.toContain('private diagnostic')
})

test('a collection-only editor can see the real pending purge on their content screen', async () => {
  await failed.upload(files.png(800, 600), 'collection-notice.png', { en: 'Collection image' })
  const text = mountAdmin('/admin/cms/collections/posts', failed.fetchAs(['cms.collections.view']))
  await expect.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).not.toContain('private diagnostic')
})

test('the loaded menu editor shows one purge warning', async () => {
  await failed.upload(files.png(800, 600), 'menu-notice.png', { en: 'Menu image' })
  const requests: Array<Promise<Response>> = []
  const fetch: typeof failed.fetch = (input, init) => {
    const response = failed.fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/cache-purges')) requests.push(response)
    return response
  }
  mountAdmin('/admin/cms/menus/main', fetch)
  await expect.poll(() => button('Zverejniť')).toBeTruthy()
  await Promise.all(requests)
  await failed.call('GET', '/menus/main')
  await expect
    .poll(() =>
      [...document.querySelectorAll('[role="status"]')].filter((notice) =>
        notice.textContent?.includes('Živý web môže zobrazovať predchádzajúcu verziu'),
      ),
    )
    .toHaveLength(1)
})

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
const type = (name: string, value: string) => {
  const field = input(name)!
  field.value = value
  field.dispatchEvent(new Event('input'))
}

test('a collection field naming an unregistered widget fails composition', () => {
  const definitions = defineCms({
    sections: {},
    systemPages: {},
    collections: {
      team: { label: 'Team', fields: { tint: fields.text({ label: 'Tint', widget: 'swatch' }) } },
    },
  })
  expect(() => cmsAdmin({ definitions })).toThrow(
    'field "tint" of collection "team" uses the widget "swatch", which is not registered',
  )
})

test('editors manage collection items in generated forms and publish them', async () => {
  const category = (
    await host.call<Item>('POST', '/collections/categories/items', {
      body: { locales: {}, data: { name: { en: 'News' } } },
    })
  ).body
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Draft post' } } },
    })
  ).body

  const text = mountAdmin('/admin/cms/collections/posts')
  await expect.poll(text).toContain('Draft post')
  const nav = document.querySelector('nav')?.textContent
  expect(nav).toContain('Kolekcie')
  expect(nav).toContain('Menu')
  expect(nav).toContain('Nastavenia webu')

  history.replaceState(null, '', `/admin/cms/items/${post.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(() => input('data.title.en')).toBeTruthy()

  // Routed collections edit path and SEO; references offer the collection's items.
  expect(input('locales.en.path')).toBeTruthy()
  await expect.poll(text).toContain('News')

  type('data.title.en', 'Hello world')
  type('locales.en.path', '/blog/hello-world')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  const saved = (await host.call<Item>('GET', `/items/${post.id}`)).body
  expect(saved.draft.data).toEqual({ title: { en: 'Hello world' } })
  expect(saved.draft.locales.en?.path).toBe('/blog/hello-world')

  button('Zverejniť')!.click()
  await expect.poll(text).toContain('Zverejnené.')
  expect((await host.call<Item>('GET', `/items/${post.id}`)).body.status).toBe('published')
  expect(category.title).toBe('News')
})

test('editors edit and publish the site settings', async () => {
  const text = mountAdmin('/admin/cms/settings')
  await expect.poll(() => input('data.phone')).toBeTruthy()
  expect(input('data.siteName.it')).toBeTruthy()
  type('data.phone', '+421 900 111 222')
  type('data.siteName.en', 'Example')
  button('Zverejniť')!.click()
  await expect.poll(text).toContain('Zverejnené.')
  const settings = (await host.call<SiteSettings>('GET', '/settings')).body
  expect(settings.status).toBe('published')
  expect(settings.published?.data).toEqual({
    phone: '+421 900 111 222',
    siteName: { en: 'Example' },
  })
})

test.each(editors)(
  'a $kind editor whose draft changed meanwhile keeps their input and can reload',
  async (c) => {
    const path = await c.open()
    const text = mountAdmin(`/admin/cms${path}`)
    await expect.poll(() => input(c.field)).toBeTruthy()
    type(c.field, 'Mine, unsaved')
    expect((await host.saveDraft(path, c.theirs())).status).toBe(200)
    const theirs = (await host.call<Document>('GET', path)).body

    button('Zverejniť')!.click()
    await expect.poll(text).toContain('Tento koncept medzitým zmenil niekto iný.')
    expect(input(c.field)?.value).toBe('Mine, unsaved')
    expect((await host.call<Document>('GET', path)).body).toEqual(theirs)

    button('Načítať koncept')!.click()
    await expect.poll(() => input(c.field)?.value).toBe(c.stored(theirs))
    expect(text()).not.toContain('Tento koncept medzitým zmenil niekto iný.')
  },
)

test('a publish still saving cannot publish the page the editor navigated to', async () => {
  const a = (await host.create(page({ en: '/admin-publish-race-a' }))).body
  const b = (await host.create(page({ en: '/admin-publish-race-b' }))).body
  const held = admin.gate()
  let saving = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.method === 'PUT' && request.url.includes(`/pages/${a.id}/draft`)) {
      saving = true
      await held.promise
    }
    return response
  }
  const text = mountAdmin(`/admin/cms/pages/${a.id}`, fetch)
  await expect.poll(() => input('locales.en.path')).toBeTruthy()
  button('Zverejniť')!.click()
  await expect.poll(() => saving).toBe(true)
  history.pushState(null, '', `/admin/cms/pages/${b.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(() => input('locales.en.path')?.value).toBe('/admin-publish-race-b')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  held.resolve()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect((await host.call<Page>('GET', `/pages/${b.id}`)).body.published).toBeNull()
  expect((await host.call<Page>('GET', `/pages/${a.id}`)).body.published).toBeNull()
})

test('a publish that conflicts after its save keeps the input and editing re-enabled', async () => {
  const held = admin.gate()
  let saving = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.method === 'PUT' && request.url.includes('/settings/draft')) {
      saving = true
      await held.promise
    }
    return response
  }
  const text = mountAdmin('/admin/cms/settings', fetch)
  await expect.poll(() => input('data.siteName.en')).toBeTruthy()
  type('data.siteName.en', 'Submitted')
  button('Zverejniť')!.click()
  await expect.poll(() => saving).toBe(true)
  expect(input('data.siteName.en')!.closest('fieldset[disabled]')).not.toBeNull()
  expect((await host.saveDraft('/settings', { data: { siteName: { en: 'Theirs' } } })).status).toBe(
    200,
  )
  held.resolve()
  await expect.poll(text).toContain('Tento koncept medzitým zmenil niekto iný.')
  expect(input('data.siteName.en')?.value).toBe('Submitted')
  expect(input('data.siteName.en')!.closest('fieldset[disabled]')).toBeNull()
})

test.each([
  ...editors.map((editor) => ({ ...editor, action: 'save' })),
  { ...editors[0]!, action: 'publish' },
])(
  'a $kind editor submitting twice before the first $action returns can keep saving',
  async (c) => {
    const path = await c.open()
    const run = crypto.randomUUID()
    const held = admin.gate()
    const saves: Array<number> = []
    const fetch: typeof host.fetch = async (input, init) => {
      const request = new Request(input, init)
      const response = await host.fetch(request)
      if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/draft')) {
        saves.push(response.status)
        if (saves.length === 1) await held.promise
      }
      return response
    }
    const text = mountAdmin(`/admin/cms${path}`, fetch)
    await expect.poll(() => input(c.field)).toBeTruthy()
    type(c.field, `/rapid-one-${run}`)
    const submit = () =>
      c.action === 'save'
        ? document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
        : button('Zverejniť')!.click()
    submit()
    await expect.poll(() => saves.length).toBe(1)
    submit()
    await new Promise((resolve) => setTimeout(resolve, 30))
    held.resolve()
    await expect.poll(text).toContain(c.action === 'save' ? 'Koncept uložený.' : 'Zverejnené.')

    type(c.field, `/rapid-two-${run}`)
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await expect.poll(() => saves.length).toBe(2)
    expect(saves).toEqual([200, 200])
    expect(c.stored((await host.call<Document>('GET', path)).body)).toBe(`/rapid-two-${run}`)
  },
)

test.each([
  ...editors.map((editor) => ({ ...editor, action: 'Uložiť koncept' })),
  { ...editors[0]!, action: 'Zverejniť' },
])('a $kind editor cannot type while "$action" is in flight', async (c) => {
  const path = await c.open()
  const value = `/locked-${crypto.randomUUID()}`
  const held = admin.gate()
  let holding = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/draft') && !holding) {
      holding = true
      await held.promise
    }
    return response
  }
  const editable = () => {
    const field = input(c.field)
    return field !== null && !field.disabled && field.closest('fieldset[disabled]') === null
  }
  const text = mountAdmin(`/admin/cms${path}`, fetch)
  await expect.poll(editable).toBe(true)
  type(c.field, value)
  button(c.action)!.click()
  await expect.poll(() => holding).toBe(true)
  expect(editable()).toBe(false)

  held.resolve()
  await expect.poll(text).toContain(c.action === 'Zverejniť' ? 'Zverejnené.' : 'Koncept uložený.')
  expect(editable()).toBe(true)
  expect(input(c.field)?.value).toBe(c.stored((await host.call<Document>('GET', path)).body))
})

test('rich text and reference pickers are locked while an item save is in flight', async () => {
  const name = `Locked ${crypto.randomUUID()}`
  await host.call('POST', '/collections/categories/items', {
    body: { locales: {}, data: { name: { en: name } } },
  })
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Locked widgets' } } },
    })
  ).body
  const held = admin.gate()
  let holding = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/draft') && !holding) {
      holding = true
      await held.promise
    }
    return response
  }
  const text = mountAdmin(`/admin/cms/items/${post.id}`, fetch)
  const row = () => {
    const picker = [...document.querySelectorAll<HTMLTableElement>('table')].find(
      (table) => table.caption?.textContent?.trim() === 'Kategórie',
    )
    return [...(picker?.querySelectorAll<HTMLElement>('tbody tr') ?? [])].find((r) =>
      r.textContent?.includes(name),
    )
  }
  const richText = () => document.querySelector('.tiptap[contenteditable="true"]')
  await expect.poll(row).toBeTruthy()
  await expect.poll(richText).toBeTruthy()

  button('Uložiť koncept')!.click()
  await expect.poll(() => holding).toBe(true)
  expect(richText()).toBeNull()
  row()!.click()
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(document.querySelector(`[aria-label="Odstrániť ${name}"]`)).toBeNull()

  held.resolve()
  await expect.poll(text).toContain('Koncept uložený.')
  await expect.poll(richText).toBeTruthy()
  row()!.click()
  await expect.poll(() => document.querySelector(`[aria-label="Odstrániť ${name}"]`)).toBeTruthy()
})

test('no button in the page editor form can change the draft while a save is in flight', async () => {
  const created = (
    await host.create(
      page({ en: `/lock-buttons-${crypto.randomUUID()}` }, [
        section('hero', { title: { en: 'First' } }),
        section('hero', { title: { en: 'Second' } }),
      ]),
    )
  ).body
  const held = admin.gate()
  let holding = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/draft') && !holding) {
      holding = true
      await held.promise
    }
    return response
  }
  const text = mountAdmin(`/admin/cms/pages/${created.id}`, fetch)
  const formButtons = () => [...document.querySelectorAll<HTMLButtonElement>('form button')]
  const usable = () =>
    formButtons()
      .filter((b) => !b.disabled && b.closest('fieldset[disabled]') === null)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
  await expect
    .poll(() => formButtons().some((b) => b.getAttribute('aria-label') === 'Odstrániť sekciu'))
    .toBe(true)

  button('Uložiť koncept')!.click()
  await expect.poll(() => holding).toBe(true)
  expect(usable()).toEqual([])

  held.resolve()
  await expect.poll(text).toContain('Koncept uložený.')
  expect(usable()).toContain('Odstrániť sekciu')
})

test.each([
  { action: 'Uložiť koncept', held: 'PUT /draft', done: 'Koncept uložený.' },
  { action: 'Zverejniť', held: 'PUT /draft', done: 'Zverejnené.' },
  { action: 'Zverejniť', held: 'POST /publish', done: 'Zverejnené.' },
  {
    action: 'Obnoviť do konceptu',
    held: 'POST /restore',
    done: 'Revízia bola obnovená do konceptu.',
  },
])('a cover upload that returns while "$action" waits on $held stays picked', async (c) => {
  const restoring = c.held === 'POST /restore'
  const title = { en: 'Cover race' }
  const earlier = restoring ? await host.upload(files.png(20, 20), 'earlier-cover.png') : undefined
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: earlier ? { title, cover: earlier } : { title } },
    })
  ).body
  const published = (
    await host.call<Item>('POST', `/items/${post.id}/publish?version=${post.version}`)
  ).body
  if (restoring)
    await host.call('PUT', `/items/${post.id}/draft?version=${published.version}`, {
      body: { locales: {}, data: { title } },
    })
  const filename = `cover-${crypto.randomUUID()}.png`
  const uploadHeld = admin.gate()
  const actionHeld = admin.gate()
  let uploaded: string | undefined
  let holding = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === '/api/media/items') {
      uploaded = ((await response.clone().json()) as { id: string }).id
      await uploadHeld.promise
    } else if (`${request.method} /${pathname.split('/').pop()}` === c.held && !holding) {
      holding = true
      await actionHeld.promise
    }
    return response
  }
  const text = mountAdmin(`/admin/cms/items/${post.id}`, fetch)
  const cover = () =>
    [...document.querySelectorAll('form p')].find((p) => p.textContent?.trim() === 'Obálka')
      ?.parentElement
  await expect.poll(() => cover()?.querySelector('button')).toBeTruthy()
  if (restoring) {
    await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
    button('Zobraziť revíziu')!.click()
    await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  }

  cover()!.querySelector('button')!.click()
  await expect.poll(() => document.querySelector('[role="dialog"] input[type="file"]')).toBeTruthy()
  const picker = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!
  Object.defineProperty(picker, 'files', {
    value: [new File([files.png(40, 30).slice()], filename, { type: 'image/png' })],
    configurable: true,
  })
  picker.dispatchEvent(new Event('change'))
  await expect.poll(() => uploaded).toBeTruthy()
  document
    .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Zatvoriť"]')!
    .click()
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()

  button(c.action)!.click()
  if (restoring) {
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy()
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === c.action)!
      .click()
  }
  await expect.poll(() => holding).toBe(true)
  uploadHeld.resolve()
  await new Promise((resolve) => setTimeout(resolve, 30))
  actionHeld.resolve()
  await expect.poll(text).toContain(c.done)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(cover()?.textContent).toContain(filename)
  expect(cover()?.textContent).not.toContain('earlier-cover.png')
  expect((await host.call<Item>('GET', `/items/${post.id}`)).body.draft.data.cover).toBe(earlier)

  button('Uložiť koncept')!.click()
  await expect
    .poll(async () => (await host.call<Item>('GET', `/items/${post.id}`)).body.draft.data.cover)
    .toBe(uploaded)
})

test('editors build a menu from entries with labels per locale and links', async () => {
  const text = mountAdmin('/admin/cms/menus/main')
  await expect.poll(() => button('Pridať položku')).toBeTruthy()
  expect(text()).toContain('Hlavné menu')
  button('Pridať položku')!.click()
  await expect.poll(() => input('items.0.label.en')).toBeTruthy()
  type('items.0.label.en', 'Docs')
  type('items.0.label.it', 'Documenti')
  type('items.0.link.url', 'https://example.test/docs')
  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  const menu = (await host.call<Menu>('GET', '/menus/main')).body
  expect(menu.draft.items).toEqual([
    {
      id: expect.any(String),
      label: { en: 'Docs', it: 'Documenti' },
      link: { type: 'url', url: 'https://example.test/docs' },
      children: [],
    },
  ])
})
