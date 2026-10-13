import type { PublicSite, ResolveResult } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { files } from '../media/helpers.ts'
import { locale, page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

/** An anonymous Read API call, as a public site makes it. */
const read = <Body>(path: string) => host.call<Body>('GET', path, { as: null })
const resolve = (path: string) => read<ResolveResult>(`/resolve?path=${encodeURIComponent(path)}`)
const tags = (headers: Headers) => (headers.get('cache-tag') ?? '').split(',').sort()

const publishedPage = async (
  paths: { en: string; it?: string },
  sections: Parameters<typeof page>[1] = [],
) => {
  const created = await host.create(page(paths, sections))
  expect(created.status).toBe(200)
  const published = await host.publish(created.body.id)
  expect(published.status).toBe(200)
  return created.body.id
}

test('resolve answers a published page per content locale, the default locale unprefixed', async () => {
  const id = await publishedPage({ en: '/about', it: '/chi-siamo' }, [
    section('rich_text', { body: { en: '<p>Hello</p>', it: '<p>Ciao</p>' } }),
  ])

  const en = await resolve('/about')
  expect(en.status).toBe(200)
  expect(en.body).toMatchObject({
    kind: 'page',
    id,
    systemKey: null,
    locale: 'en',
    path: '/about',
    alternates: [
      { locale: 'en', path: '/about' },
      { locale: 'it', path: '/it/chi-siamo' },
    ],
    seo: { title: '', description: '', image: null, noindex: false },
    sections: [{ type: 'rich_text', data: { body: '<p>Hello</p>' } }],
  })
  expect(en.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  expect(tags(en.headers)).toEqual(['cms', `cms:page:${id}`])

  const it = await resolve('/it/chi-siamo')
  expect(it.body).toMatchObject({
    kind: 'page',
    locale: 'it',
    path: '/it/chi-siamo',
    sections: [{ data: { body: '<p>Ciao</p>' } }],
  })
  // Paths belong to their locale: the Italian path is not an English page.
  expect((await resolve('/chi-siamo')).body).toEqual({ kind: 'not_found', locale: 'en' })
})

test('only published content is visible: drafts, unpublished and unavailable locales are not found', async () => {
  const draft = await host.create(page({ en: '/draft-only' }))
  expect(draft.status).toBe(200)
  expect((await resolve('/draft-only')).body).toEqual({ kind: 'not_found', locale: 'en' })

  const id = await publishedPage({ en: '/live' })
  await host.save(id, page({ en: '/live' }, [section('rich_text', { body: { en: '<p>new</p>' } })]))
  expect((await resolve('/live')).body).toMatchObject({ kind: 'page', sections: [] })

  // Italian is not available, so /it/live is not found and English lists no Italian alternate.
  expect((await resolve('/it/live')).body).toEqual({ kind: 'not_found', locale: 'it' })
  expect((await resolve('/live')).body).toMatchObject({
    alternates: [{ locale: 'en', path: '/live' }],
  })

  await host.call('POST', `/pages/${id}/unpublish`)
  expect((await resolve('/live')).body).toEqual({ kind: 'not_found', locale: 'en' })
})

test('resolve answers redirects with prefixed paths, and normalizes trailing slashes and the default prefix', async () => {
  await host.call('POST', '/redirects', {
    body: { locale: 'it', from: '/vecchio', to: '/nuovo', status: 302 },
  })
  const moved = await resolve('/it/vecchio')
  expect(moved.body).toEqual({ kind: 'redirect', locale: 'it', to: '/it/nuovo', status: 302 })
  expect(tags(moved.headers)).toEqual(['cms', 'cms:routes'])

  expect((await resolve('/about/')).body).toEqual({
    kind: 'redirect',
    locale: 'en',
    to: '/about',
    status: 301,
  })
  expect((await resolve('/en/about')).body).toEqual({
    kind: 'redirect',
    locale: 'en',
    to: '/about',
    status: 301,
  })
  const missing = await resolve('/nowhere')
  expect(missing.body).toEqual({ kind: 'not_found', locale: 'en' })
  expect(tags(missing.headers)).toEqual(['cms', 'cms:routes'])
  expect((await resolve('/it')).body).toEqual({ kind: 'not_found', locale: 'it' })
})

test('resolve never redirects off-site: encoded slashes and backslashes are not paths', async () => {
  for (const path of [
    '/en/%2Fevil.example',
    '/en/%2F%2Fevil.example/',
    '/%2Fevil.example/',
    '/%5Cevil.example/',
    '/en/%5Cevil.example',
    '/en/%09/evil.example',
  ]) {
    const { body } = await resolve(path)
    if (body.kind === 'redirect') expect(body.to, path).toMatch(/^\/(?![/\\])/)
  }
  // Non-canonical but harmless paths still redirect to their canonical form.
  expect((await resolve('/en//about/')).body).toMatchObject({ kind: 'redirect', to: '/about' })
})

test('a path change resolves the old path as a redirect to the new one', async () => {
  const id = await publishedPage({ en: '/old-name', it: '/vecchio-nome' })
  await host.save(id, page({ en: '/new-name', it: '/vecchio-nome' }))
  await host.publish(id)
  expect((await resolve('/old-name')).body).toEqual({
    kind: 'redirect',
    locale: 'en',
    to: '/new-name',
    status: 301,
  })
  expect((await resolve('/new-name')).body).toMatchObject({ kind: 'page', id })
})

test('a default-locale path may not start with another locale prefix', async () => {
  const { status, body } = await host.create(page({ en: '/it/shadowed' }))
  expect(status).toBe(400)
  expect(body).toMatchObject({ message: expect.stringContaining('prefix of it pages') })
})

test('a page path resolves in every locale up to the longest path a write accepts', async () => {
  const longest = (n: number) => `/${crypto.randomUUID()}-${'a'.repeat(n - 38)}`
  const en = longest(1024)
  const it = longest(1024)
  expect(en.length).toBe(1024)
  const id = await publishedPage({ en, it })
  expect((await resolve(en)).body).toMatchObject({ kind: 'page', id, path: en })
  expect((await resolve(`/it${it}`)).body).toMatchObject({ kind: 'page', id, locale: 'it' })
  const { status, body } = await host.create(page({ en: longest(1025) }))
  expect(status).toBe(400)
  expect(body).toMatchObject({ message: expect.stringContaining('1024') })
})

test('the homepage resolves at / and at the locale root; unicode paths are decoded', async () => {
  await publishedPage({ en: '/', it: '/' })
  expect((await resolve('/')).body).toMatchObject({ kind: 'page', path: '/' })
  expect((await resolve('/it')).body).toMatchObject({
    kind: 'page',
    locale: 'it',
    path: '/it',
    alternates: [
      { locale: 'en', path: '/' },
      { locale: 'it', path: '/it' },
    ],
  })
  await publishedPage({ en: '/čo-robíme' })
  expect((await resolve(new URL('https://x.test/čo-robíme').pathname)).body).toMatchObject({
    kind: 'page',
    path: '/čo-robíme',
  })
  expect((await resolve('/%E0%A4%A')).body).toEqual({ kind: 'not_found', locale: 'en' })
})

test('media ids resolve to url, alt, dimensions, mime and srcset; links to public hrefs with their tags', async () => {
  const lake = await host.upload(files.png(800, 600), 'lake.png', { en: 'A lake', it: 'Un lago' })
  const target = await publishedPage({ en: '/target', it: '/obiettivo' })
  const created = await host.create({
    locales: {
      en: locale('/with-media', {
        seo: { title: 'Media', description: 'd', image: lake, noindex: true },
      }),
      it: locale('/con-media'),
    },
    sections: [
      section('hero', { title: { en: 'Hi', it: 'Ciao' }, image: lake }),
      section('hero', { title: { en: 'Gone' }, image: crypto.randomUUID() }),
    ],
  })
  expect((await host.publish(created.body.id)).status).toBe(200)

  const it = await resolve('/it/con-media')
  expect(it.body).toMatchObject({
    kind: 'page',
    seo: { image: null, noindex: false },
    sections: [
      {
        type: 'hero',
        data: {
          title: 'Ciao',
          image: {
            id: lake,
            url: `/media/${lake}/1/lake.png`,
            alt: 'Un lago',
            width: 800,
            height: 600,
            mime: 'image/png',
            srcset: expect.stringContaining('320w'),
          },
        },
      },
      // Falls back to the default locale; a media id that is gone resolves to null.
      { data: { title: 'Gone', image: null } },
    ],
  })
  expect((await resolve('/with-media')).body).toMatchObject({
    seo: { title: 'Media', image: { id: lake, alt: 'A lake' }, noindex: true },
  })

  await host.call('PUT', '/settings/draft', {
    body: { data: { siteName: { en: 'Example' }, cta: { type: 'page', id: target } } },
  })
  await host.call('POST', '/settings/publish')
  const site = await read<PublicSite>('/site?locale=it')
  expect(site.body.settings).toMatchObject({
    siteName: 'Example',
    cta: { type: 'page', id: target, href: '/it/obiettivo' },
  })
  expect(tags(site.headers)).toEqual(
    expect.arrayContaining(['cms', 'cms:site', `cms:page:${target}`]),
  )
})

test('site answers menus with resolved hrefs and the system pages map per locale', async () => {
  const empty = await read<PublicSite>('/site')
  expect(empty.body).toMatchObject({
    locale: 'en',
    locales: ['en', 'it'],
    menus: { main: [], footer: [] },
    systemPages: { home: null, contact: null },
  })
  // System pages that do not exist yet: their first publish purges cms:routes.
  expect(tags(empty.headers)).toEqual(expect.arrayContaining(['cms', 'cms:routes', 'cms:site']))

  const pages = await host.call<{ rows: Array<{ id: string; systemKey: string | null }> }>(
    'GET',
    '/pages',
  )
  const systemPage = (key: string) => pages.body.rows.find((p) => p.systemKey === key)!.id
  expect((await host.publish(systemPage('contact'))).status).toBe(200)
  const about = await publishedPage({ en: '/about-us', it: '/chi-siamo-noi' })
  const entry = (label: string, link: unknown, children: Array<unknown> = []) => ({
    id: crypto.randomUUID(),
    label: { en: label },
    link,
    children,
  })
  await host.call('PUT', '/menus/main/draft', {
    body: {
      items: [
        entry('About', { type: 'page', id: about }, [
          entry('Contact', { type: 'system', key: 'contact' }),
        ]),
        entry('Docs', { type: 'url', url: 'https://example.test/docs' }),
      ],
    },
  })
  await host.call('POST', '/menus/main/publish')

  const it = await read<PublicSite>('/site?locale=it')
  expect(it.body.menus.main).toMatchObject([
    {
      label: 'About',
      href: '/it/chi-siamo-noi',
      children: [{ label: 'Contact', href: '/it/contatti' }],
    },
    { label: 'Docs', href: 'https://example.test/docs' },
  ])
  expect(it.body.systemPages).toEqual({ home: null, contact: '/it/contatti' })
  expect(tags(it.headers)).toEqual(
    expect.arrayContaining([
      'cms',
      'cms:site',
      `cms:page:${about}`,
      `cms:page:${systemPage('contact')}`,
      `cms:page:${systemPage('home')}`,
    ]),
  )
  expect((await read('/site?locale=de')).status).toBe(400)
})

interface List {
  rows: Array<{ id: string; path: string | null; data: Record<string, unknown> }>
  total: number
  page: number
  perPage: number
}

test('a routed item resolves at its path; collections list published items with filters', async () => {
  const createItem = async (collection: string, body: unknown) => {
    const created = await host.call<{ id: string }>('POST', `/collections/${collection}/items`, {
      body,
    })
    expect(created.status).toBe(200)
    return created.body.id
  }
  const news = await createItem('categories', { locales: {}, data: { name: { en: 'News' } } })
  await host.call('POST', `/items/${news}/publish`)
  const posts: Array<string> = []
  for (const n of [1, 2, 3]) {
    const id = await createItem('posts', {
      locales: {
        en: locale(`/blog/post-${n}`),
        ...(n === 1 ? { it: locale('/blog/articolo-1') } : {}),
      },
      data: { title: { en: `Post ${n}` }, categories: n === 3 ? [] : [news] },
    })
    expect((await host.call('POST', `/items/${id}/publish`)).status).toBe(200)
    posts.push(id)
  }
  await createItem('posts', {
    locales: { en: locale('/blog/draft') },
    data: { title: { en: 'D' } },
  })

  const one = await resolve('/blog/post-1')
  expect(one.body).toMatchObject({
    kind: 'item',
    id: posts[0],
    collection: 'posts',
    path: '/blog/post-1',
    alternates: [
      { locale: 'en', path: '/blog/post-1' },
      { locale: 'it', path: '/it/blog/articolo-1' },
    ],
    data: { title: 'Post 1', categories: [news] },
  })
  expect(tags(one.headers)).toEqual(['cms', `cms:item:${posts[0]}`])

  const all = await read<List>('/collections/posts')
  expect(all.body).toMatchObject({ total: 3, page: 1, perPage: 20 })
  expect(all.body.rows.map((r) => r.id)).toEqual([...posts].reverse())
  expect(all.body.rows[2]).toMatchObject({ path: '/blog/post-1', data: { title: 'Post 1' } })
  expect(tags(all.headers)).toEqual(['cms', 'cms:collection:posts'])

  const oldest = await read<List>('/collections/posts?sort=oldest&perPage=2&page=2')
  expect(oldest.body).toMatchObject({ total: 3, page: 2, perPage: 2, rows: [{ id: posts[2] }] })
  const italian = await read<List>('/collections/posts?locale=it')
  expect(italian.body.rows).toMatchObject([{ id: posts[0], path: '/it/blog/articolo-1' }])
  const inNews = await read<List>(`/collections/posts?ref=${news}`)
  expect(inNews.body.rows.map((r) => r.id).sort()).toEqual([posts[0], posts[1]].sort())
  const byIds = await read<List>(`/collections/categories?ids=${news},${posts[0]}`)
  expect(byIds.body.rows).toMatchObject([{ id: news, path: null, data: { name: 'News' } }])

  expect((await read('/collections/nope')).status).toBe(404)
  expect((await read('/collections/posts?ref=nope')).status).toBe(400)
  expect((await read('/collections/posts?perPage=500')).status).toBe(400)
})

test('publish, unpublish and redirect writes purge the tags the Read API answered with', async () => {
  const before = host.purged.length
  const id = await publishedPage({ en: '/purged' })
  await host.call('POST', `/pages/${id}/unpublish`)
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/purged-old', to: '/purged', status: 301 },
  })
  expect(host.purged.slice(before)).toEqual([
    [`cms:page:${id}`, 'cms:routes'],
    [`cms:page:${id}`, 'cms:routes'],
    ['cms:routes'],
  ])
})
