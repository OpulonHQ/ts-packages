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
import { expect } from 'vitest'
import { defineComponent, h, provide, reactive, ref, type VNode } from 'vue'
import { adminModules } from '../../admin/modules.ts'
import { definitions } from '../../cms/definitions.ts'
import RevisionView from '../../../../packages/cms/src/admin/RevisionView.vue'
import { cmsContextKey } from '../../../../packages/cms/src/admin/use-cms.ts'
import type { RevisionSnapshot } from '../../../../packages/cms/src/admin/use-revisions.ts'
import { files } from '../media/helpers.ts'
import { test as adminTest } from '../admin-scope.ts'
import { page, section, useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk.
const cmsHost = useCmsHost()
const failedHost = useCmsHost(undefined, async () => ({
  success: false,
  errors: [{ code: 1, message: 'private diagnostic' }],
}))
let mediaPurgeRefused = false
const mediaOnlyHost = useCmsHost(undefined, async () => ({
  success: !mediaPurgeRefused,
  errors: mediaPurgeRefused ? [{ code: 1, message: 'private media diagnostic' }] : [],
}))
const test = adminTest.extend<{
  host: typeof cmsHost
  failed: typeof failedHost
  mediaOnly: typeof mediaOnlyHost
}>({
  host: async ({ scope }, use) => use(scope.host(cmsHost)),
  failed: async ({ scope }, use) => use(scope.host(failedHost)),
  mediaOnly: async ({ scope }, use) => use(scope.host(mediaOnlyHost)),
})
const testScreen = (setup: () => () => VNode) => defineComponent({ setup })

test.for(['item', 'page'])(
  'every %s revision JSON block preserves stored values after form rendering',
  async (kind, { host, scope }) => {
    const snapshot: RevisionSnapshot =
      kind === 'item'
        ? await (async () => {
            const created = (
              await host.call<Item>('POST', '/collections/posts/items', {
                body: { locales: {}, data: { title: { en: 'Stored JSON item' } } },
              })
            ).body
            const published = (await host.call<Item>('POST', `/items/${created.id}/publish`)).body
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
    scope.mount('/admin/cms/items/stored-json', { fetch: host.fetch, modules })
    await scope
      .poll(() =>
        document.querySelector(
          `input[name="revision.${kind === 'item' ? 'data.title.en' : 'sections.0.subtitle.en'}"]`,
        ),
      )
      .toBeTruthy()
    fallback!()
    await scope.poll(() => document.querySelectorAll('pre').length).toBe(2)
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

test('read-only revision forms preserve the stored snapshot on rerender and restore by id', async ({
  host,
  scope,
}) => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: { title: { en: 'Stored revision title' } } },
    })
  ).body
  const first = (await host.call<Item>('POST', `/items/${created.id}/publish`)).body
  await host.call('PUT', `/items/${created.id}/draft`, {
    body: { locales: {}, data: { title: { en: 'New draft title' } } },
  })
  await host.call('POST', `/items/${created.id}/publish`)
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
    if (request.url.endsWith('/restore')) restoreBody = await request.clone().text()
    return host.fetch(request)
  }
  const text = scope.mount(`/admin/cms/items/${created.id}`, { fetch, modules })
  await scope
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
  await scope.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  rerender!()
  await scope.poll(() => button('Restore to draft')).toBeTruthy()
  expect(JSON.parse(document.querySelector('details pre')!.textContent!)).toEqual(first.draft)
  button('Restore to draft')!.click()
  await scope.poll(text).toContain('This replaces the current draft')
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((b) => b.textContent?.trim() === 'Restore to draft')!
    .click()
  await scope.poll(text).toContain('Revision restored to draft.')
  expect(restoreBody).toBe('')
  const restored = (await host.call<Item>('GET', `/items/${created.id}`)).body
  expect(JSON.stringify(restored.draft)).toBe(JSON.stringify(first.draft))
})

test('a late page request cannot replace the editor after navigation', async ({ host, scope }) => {
  const a = (await host.create(page({ en: '/admin-race-a' }))).body
  const b = (await host.create(page({ en: '/admin-race-b' }))).body
  const held = scope.gate()
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
  const text = scope.mount(`/admin/cms/pages/${a.id}`, { fetch })
  await scope.poll(() => requested).toBe(true)
  history.pushState(null, '', `/admin/cms/pages/${b.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await scope.poll(text).toContain('/admin-race-b')
  held.resolve()
  await scope.sleep(30)
  expect(document.querySelector<HTMLInputElement>('input[name="locales.en.path"]')?.value).toBe(
    '/admin-race-b',
  )
})

test('revision history views a snapshot and restores it to the editor without publishing', async ({
  host,
  scope,
}) => {
  const created = (await host.create(page({ en: '/admin-revision-old' }))).body
  const first = (await host.publish(created.id)).body
  await host.save(created.id, page({ en: '/admin-revision-new' }))
  const second = (await host.publish(created.id)).body
  const text = scope.mount(`/admin/cms/pages/${created.id}`, { fetch: host.fetch })
  await scope.poll(text).toContain('História revízií')
  await scope
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
  await scope
    .poll(() => document.querySelector('input[name="revision.locales.en.path"]'))
    .toBeTruthy()
  expect(
    document.querySelector<HTMLInputElement>('input[name="revision.locales.en.path"]')?.value,
  ).toBe('/admin-revision-old')
  button('Obnoviť do konceptu')!.click()
  await scope.poll(text).toContain('Nahradí aktuálny koncept')
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.trim() === 'Obnoviť do konceptu',
  )
  confirm!.click()
  await scope.poll(text).toContain('Revízia bola obnovená do konceptu.')
  await scope
    .poll(() => document.querySelector<HTMLInputElement>('input[name="locales.en.path"]')?.value)
    .toBe('/admin-revision-old')
  const stored = (await host.call<Page>('GET', `/pages/${created.id}`)).body
  expect(stored.draft).toEqual(first.draft)
  expect(stored.publishedRevisionId).toBe(second.publishedRevisionId)
  expect(stored.published).toEqual(second.published)
})

test('view-only editors can inspect revisions and cannot restore', async ({ host, scope }) => {
  const created = (await host.create(page({ en: '/admin-revision-view-only' }))).body
  await host.publish(created.id)
  const text = scope.mount(`/admin/cms/pages/${created.id}`, {
    fetch: host.fetchAs(['cms.pages.view']),
  })
  await scope.poll(text).toContain('História revízií')
  await scope.poll(() => button('Zobraziť revíziu')).toBeTruthy()
  button('Zobraziť revíziu')!.click()
  await scope
    .poll(() => document.querySelector('input[name="revision.locales.en.path"]'))
    .toBeTruthy()
  expect(button('Obnoviť do konceptu')).toBeUndefined()
})

test.for([
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
])(
  '$kind screen exposes history, view and restore with the normal editor',
  async (c, { host, scope }) => {
    const id = c.create ? (await host.call<Item>('POST', c.create, { body: c.first })).body.id : ''
    const path = c.path(id)
    if (!c.create) await host.call('PUT', `${path}/draft`, { body: c.first })
    const first = (await host.call<Item | Menu | SiteSettings>('POST', `${path}/publish`)).body
    await host.call('PUT', `${path}/draft`, { body: c.second })
    const second = (await host.call<Item | Menu | SiteSettings>('POST', `${path}/publish`)).body
    const text = scope.mount(c.route(id), { fetch: host.fetch })
    await scope
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
    await scope.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
    button('Obnoviť do konceptu')!.click()
    await scope.poll(text).toContain('Nahradí aktuálny koncept')
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === 'Obnoviť do konceptu')!
      .click()
    await scope.poll(text).toContain('Revízia bola obnovená do konceptu.')
    const stored = (await host.call<Item | Menu | SiteSettings>('GET', path)).body
    expect(stored.draft).toEqual(first.draft)
    expect(stored.published).toEqual(second.published)
  },
)

test('a media-only editor sees one purge warning after edits, replacement, archive and closing details', async ({
  mediaOnly,
  scope,
}) => {
  mediaPurgeRefused = false
  await mediaOnly.upload(files.png(800, 600), 'media-only.png')
  const fetch = mediaOnly.fetchAs(['media.view', 'media.upload', 'media.archive'])
  const text = scope.mount('/admin/media', { fetch })
  const row = () =>
    [...document.querySelectorAll<HTMLElement>('tbody tr')].find((row) =>
      row.textContent?.includes('media-only.png'),
    )
  await scope.poll(row).toBeTruthy()
  row()!.click()
  await scope.poll(() => input('alt.en')).toBeTruthy()
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  mediaPurgeRefused = true
  type('alt.en', 'Media-only edit')
  button('Uložiť')!.click()
  await scope.poll(text).toContain('Uložené.')
  const warnings = () =>
    [...document.querySelectorAll('[role="status"]')].filter((notice) =>
      notice.textContent?.includes('Živý web môže zobrazovať predchádzajúcu verziu'),
    )
  await scope.poll(warnings).toHaveLength(1)
  expect(text()).not.toContain('private media diagnostic')

  const recover = async () => {
    mediaPurgeRefused = false
    await mediaOnly.query(
      "update core.cache_purge set next_attempt_at = now() - interval '1 second'",
    )
    await mediaOnly.sweep()
    button('Uložiť')!.click()
    await scope.poll(warnings).toHaveLength(0)
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
  await scope.poll(text).toContain('Súbor bol nahradený.')
  await scope.poll(warnings).toHaveLength(1)
  await recover()
  mediaPurgeRefused = true
  button('Archivovať')!.click()
  await scope.poll(text).toContain('stránky, ktoré ju už používajú')
  ;[...document.querySelectorAll('button')]
    .filter((button) => button.textContent?.trim() === 'Archivovať')
    .at(-1)!
    .click()
  await scope.poll(text).toContain('Archivované.')
  await scope.poll(warnings).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('button[data-slot="close"]')!.click()
  await scope.poll(() => input('alt.en')).toBeFalsy()
  await scope.poll(warnings).toHaveLength(1)
})

test('a media view-only editor does not see an unavailable purge status warning', async ({
  failed,
  scope,
}) => {
  await failed.upload(files.png(800, 600), 'view-only.png')
  const text = scope.mount('/admin/media', { fetch: failed.fetchAs(['media.view']) })
  await scope.poll(text).toContain('view-only.png')
  expect(text()).not.toContain('Stav vymazania vyrovnávacej pamäte nie je dostupný')
  expect(text()).not.toContain('Živý web môže zobrazovať predchádzajúcu verziu')
})

test('the composed admin shows an editor the real failed purge from a media edit', async ({
  failed,
  scope,
}) => {
  const id = await failed.upload(files.png(800, 600), 'notice.png')
  const changed = await failed.fetch(`https://host.test/api/media/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alt: { en: 'Edited alt' }, caption: { en: 'Edited caption' } }),
  })
  expect(changed.status).toBe(200)
  const text = scope.mount('/admin/cms/pages', { fetch: failed.fetch })
  await scope.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).toContain('vymazanie vyrovnávacej pamäte')
  expect(text()).not.toContain('private diagnostic')
})

test('a collection-only editor can see the real pending purge on their content screen', async ({
  failed,
  scope,
}) => {
  await failed.upload(files.png(800, 600), 'collection-notice.png', { en: 'Collection image' })
  const text = scope.mount('/admin/cms/collections/posts', {
    fetch: failed.fetchAs(['cms.collections.view']),
  })
  await scope.poll(text).toContain('Živý web môže zobrazovať predchádzajúcu verziu')
  expect(text()).not.toContain('private diagnostic')
})

test('the loaded menu editor shows one purge warning', async ({ failed, scope }) => {
  await failed.upload(files.png(800, 600), 'menu-notice.png', { en: 'Menu image' })
  const requests: Array<Promise<Response>> = []
  const fetch: typeof failed.fetch = (input, init) => {
    const response = failed.fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/cache-purges')) requests.push(response)
    return response
  }
  scope.mount('/admin/cms/menus/main', { fetch })
  await scope.poll(() => button('Zverejniť')).toBeTruthy()
  await Promise.all(requests)
  await failed.call('GET', '/menus/main')
  await scope
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

test('editors manage collection items in generated forms and publish them', async ({
  host,
  scope,
}) => {
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

  const text = scope.mount('/admin/cms/collections/posts', { fetch: host.fetch })
  await scope.poll(text).toContain('Draft post')
  const nav = document.querySelector('nav')?.textContent
  expect(nav).toContain('Kolekcie')
  expect(nav).toContain('Menu')
  expect(nav).toContain('Nastavenia webu')

  history.replaceState(null, '', `/admin/cms/items/${post.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await scope.poll(() => input('data.title.en')).toBeTruthy()

  // Routed collections edit path and SEO; references offer the collection's items.
  expect(input('locales.en.path')).toBeTruthy()
  await scope.poll(text).toContain('News')

  type('data.title.en', 'Hello world')
  type('locales.en.path', '/blog/hello-world')
  button('Uložiť koncept')!.click()
  await scope.poll(text).toContain('Koncept uložený.')
  const saved = (await host.call<Item>('GET', `/items/${post.id}`)).body
  expect(saved.draft.data).toEqual({ title: { en: 'Hello world' } })
  expect(saved.draft.locales.en?.path).toBe('/blog/hello-world')

  button('Zverejniť')!.click()
  await scope.poll(text).toContain('Zverejnené.')
  expect((await host.call<Item>('GET', `/items/${post.id}`)).body.status).toBe('published')
  expect(category.title).toBe('News')
})

test('editors edit and publish the site settings', async ({ host, scope }) => {
  const text = scope.mount('/admin/cms/settings', { fetch: host.fetch })
  await scope.poll(() => input('data.phone')).toBeTruthy()
  expect(input('data.siteName.it')).toBeTruthy()
  type('data.phone', '+421 900 111 222')
  type('data.siteName.en', 'Example')
  button('Zverejniť')!.click()
  await scope.poll(text).toContain('Zverejnené.')
  const settings = (await host.call<SiteSettings>('GET', '/settings')).body
  expect(settings.status).toBe('published')
  expect(settings.published?.data).toEqual({
    phone: '+421 900 111 222',
    siteName: { en: 'Example' },
  })
})

test('editors build a menu from entries with labels per locale and links', async ({
  host,
  scope,
}) => {
  const text = scope.mount('/admin/cms/menus/main', { fetch: host.fetch })
  await scope.poll(() => button('Pridať položku')).toBeTruthy()
  expect(text()).toContain('Hlavné menu')
  button('Pridať položku')!.click()
  await scope.poll(() => input('items.0.label.en')).toBeTruthy()
  type('items.0.label.en', 'Docs')
  type('items.0.label.it', 'Documenti')
  type('items.0.link.url', 'https://example.test/docs')
  button('Uložiť koncept')!.click()
  await scope.poll(text).toContain('Koncept uložený.')
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
