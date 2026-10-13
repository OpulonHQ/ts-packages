import type {
  Item,
  Menu,
  MenuDocument,
  MenuPreview,
  SettingsPreview,
  SiteSettings,
} from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { page, useCmsHost } from './helpers.ts'

const host = useCmsHost()

const entry = (
  label: Record<string, string>,
  link: MenuDocument['items'][number]['link'],
  children: MenuDocument['items'] = [],
) => ({ id: crypto.randomUUID(), label, link, children })
const saveMenu = (key: string, items: MenuDocument['items']) =>
  host.call<Menu>('PUT', `/menus/${key}/draft`, { body: { items } })

test('site settings hold the global SEO fields and the host fields, with draft and publishing', async () => {
  const initial = await host.call<SiteSettings>('GET', '/settings')
  expect(initial.body).toMatchObject({ status: 'draft', draft: { data: {} }, published: null })

  const saved = await host.call<SiteSettings>('PUT', '/settings/draft', {
    body: {
      data: {
        siteName: { en: 'Example', it: 'Esempio' },
        twitterHandle: '@example',
        phone: '+421 900 000 000',
        cta: { type: 'system', key: 'contact' },
        unknown: 'dropped',
      },
    },
  })
  expect(saved.status).toBe(200)
  expect(saved.body.draft.data).toEqual({
    siteName: { en: 'Example', it: 'Esempio' },
    twitterHandle: '@example',
    phone: '+421 900 000 000',
    cta: { type: 'system', key: 'contact' },
  })

  const preview = await host.call<SettingsPreview>('GET', '/settings/preview?locale=it')
  expect(preview.headers.get('cache-control')).toBe('private, no-store')
  expect(preview.body.data).toMatchObject({ siteName: 'Esempio', phone: '+421 900 000 000' })

  const purges = host.purged.length
  const published = await host.call<SiteSettings>('POST', '/settings/publish')
  expect(published.body).toMatchObject({ status: 'published', published: saved.body.draft })
  expect(host.purged.slice(purges)).toEqual([['cms:site']])
  await host.call('POST', '/settings/unpublish')
  const actions = await host.query<{ action: string }>(
    `select action from core.audit_event where action like 'cms.settings.%' order by id`,
  )
  expect(actions.map((a) => a.action)).toEqual([
    'cms.settings.published',
    'cms.settings.unpublished',
  ])
  const revisions = await host.query(
    `select r.reason from cms.revision r join cms.document d on d.id = r.document_id
     where d.kind = 'settings'`,
  )
  expect(revisions).toEqual([{ reason: 'publish' }])
})

test.each([
  ['a link to an unknown system page', { type: 'system', key: 'nowhere' }, 'unknown system page'],
  ['a script URL', { type: 'url', url: 'javascript:alert(1)' }, 'must start with'],
  ['a page link without a page id', { type: 'page', id: 'about' }, 'points at no page'],
])('a settings link field refuses %s', async (_, cta, message) => {
  const { status, body } = await host.call('PUT', '/settings/draft', { body: { data: { cta } } })
  expect(status).toBe(400)
  expect(body).toMatchObject({ message: expect.stringContaining(message) })
})

test('menus are declared by the host; items link to pages, items, system pages and URLs', async () => {
  const menus = await host.call<{ rows: Array<{ key: string; status: string }> }>('GET', '/menus')
  expect(menus.body.rows.map((m) => m.key)).toEqual(['main', 'footer'])
  expect((await host.call('GET', '/menus/sidebar')).status).toBe(404)

  const about = (await host.create(page({ en: '/about', it: '/chi-siamo' }))).body
  await host.publish(about.id)
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: {
        locales: { en: { path: '/blog/first', available: true, seo: seo() } },
        data: { title: { en: 'First' } },
      },
    })
  ).body
  await host.call('POST', `/items/${post.id}/publish`)

  const saved = await saveMenu('main', [
    entry({ en: 'About', it: 'Chi siamo' }, { type: 'page', id: about.id }, [
      entry({ en: 'First post' }, { type: 'item', id: post.id }, [
        entry({ en: 'Contact' }, { type: 'system', key: 'contact' }),
      ]),
    ]),
    entry({ en: 'Docs', fr: 'dropped' }, { type: 'url', url: ' https://example.test/docs ' }),
  ])
  expect(saved.status).toBe(200)
  expect(saved.body.draft.items[1]).toMatchObject({
    label: { en: 'Docs' },
    link: { type: 'url', url: 'https://example.test/docs' },
  })

  // Preview resolves links against what is published; the contact page is not yet.
  const preview = await host.call<MenuPreview>('GET', '/menus/main/preview?locale=it')
  expect(preview.headers.get('cache-control')).toBe('private, no-store')
  const [first, docs] = preview.body.items
  expect(first).toMatchObject({ label: 'Chi siamo', href: '/it/chi-siamo' })
  expect(first?.children[0]).toMatchObject({ label: 'First post', href: null })
  expect(first?.children[0]?.children[0]).toMatchObject({ href: null })
  expect(docs).toMatchObject({ href: 'https://example.test/docs' })
  const en = (await host.call<MenuPreview>('GET', '/menus/main/preview')).body
  expect(en.items[0]?.children[0]).toMatchObject({ href: '/blog/first' })

  const purges = host.purged.length
  const published = await host.call<Menu>('POST', '/menus/main/publish')
  expect(published.body).toMatchObject({ status: 'published', key: 'main' })
  expect(host.purged.slice(purges)).toEqual([['cms:site']])
  expect(
    await host.query(`select action, subject_label from core.audit_event
      where action like 'cms.menu.%'`),
  ).toEqual([{ action: 'cms.menu.published', subject_label: 'Main menu' }])
})

test('menus nest no deeper than declared and need labels in the default locale to publish', async () => {
  const link = { type: 'url' as const, url: '/x' }
  const deep = await saveMenu('footer', [entry({ en: 'A' }, link, [entry({ en: 'B' }, link)])])
  expect(deep.status).toBe(400)
  expect(deep.body).toMatchObject({ message: '"Footer" nests at most 1 level.' })

  const tooDeep = await saveMenu('main', [
    entry({ en: 'A' }, link, [
      entry({ en: 'B' }, link, [entry({ en: 'C' }, link, [entry({ en: 'D' }, link)])]),
    ]),
  ])
  expect(tooDeep.body).toMatchObject({ message: '"Main menu" nests at most 3 levels.' })

  expect((await saveMenu('footer', [entry({ it: 'Solo' }, link)])).status).toBe(200)
  const refused = await host.call('POST', '/menus/footer/publish')
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ message: 'Menu item 1 needs a label in en.' })
})

test('site settings and menus need the site permissions', async () => {
  const pagesOnly = ['cms.pages.view', 'cms.pages.edit', 'cms.pages.publish']
  expect((await host.call('GET', '/settings', { as: pagesOnly })).status).toBe(403)
  expect((await host.call('GET', '/menus', { as: pagesOnly })).status).toBe(403)
  const viewer = ['cms.site.view']
  expect((await host.call('GET', '/menus/main', { as: viewer })).status).toBe(200)
  expect(
    (await host.call('PUT', '/settings/draft', { as: viewer, body: { data: {} } })).status,
  ).toBe(403)
  expect(
    (await host.call('POST', '/menus/main/publish', { as: ['cms.site.view', 'cms.site.edit'] }))
      .status,
  ).toBe(403)
})

test('a site linking hundreds of pages keeps its Cache-Tag header bounded, and still purged', async () => {
  const linked = (await host.create(page({ en: '/linked-from-menus' }))).body
  const links = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      entry({ en: `Page ${i}` }, { type: 'page', id: i === 0 ? linked.id : crypto.randomUUID() }),
    )
  for (const key of ['main', 'footer']) {
    expect((await saveMenu(key, links(200))).status).toBe(200)
    expect((await host.call(`POST`, `/menus/${key}/publish`)).status).toBe(200)
  }

  const site = await host.call('GET', '/site', { as: null })
  const header = site.headers.get('cache-tag')!
  // Cloudflare refuses Cache-Tag headers above 16 KiB; answers stay at most 8 KiB.
  expect(new TextEncoder().encode(header).length).toBeLessThanOrEqual(8 * 1024)
  // The links' page tags collapsed into cms:routes, which publishing any page purges.
  expect(header.split(',')).toEqual(expect.arrayContaining(['cms', 'cms:site', 'cms:routes']))
  const purges = host.purged.length
  await host.publish(linked.id)
  expect(host.purged.slice(purges).flat()).toContain('cms:routes')
})

function seo() {
  return { title: '', description: '', image: null, noindex: false }
}
