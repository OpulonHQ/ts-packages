import {
  CmsRequestError,
  createCmsClient,
  localeLinks,
  menu,
  systemPageLink,
} from '@opulonjs/cms/site'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const client = () =>
  createCmsClient({ fetch: host.publicFetch, baseUrl: 'https://host.test/api/cms' })

const publish = async (
  paths: { en: string; it?: string },
  sections: Parameters<typeof page>[1],
) => {
  const created = await host.create(page(paths, sections))
  expect((await host.publish(created.body.id)).status).toBe(200)
  return created.body.id
}

test('the client reads resolve, site and collections as typed JSON', async () => {
  const id = await publish({ en: '/about', it: '/chi-siamo' }, [
    section('rich_text', { body: { en: '<p>Hello</p>', it: '<p>Ciao</p>' } }),
  ])
  const cms = client()

  const about = await cms.resolve('/it/chi-siamo')
  expect(about).toMatchObject({ kind: 'page', id, locale: 'it', path: '/it/chi-siamo' })
  if (about.kind !== 'page') throw new Error('expected a page')
  expect(about.sections[0]?.data).toEqual({ body: '<p>Ciao</p>' })
  expect(await cms.resolve('/nowhere')).toEqual({ kind: 'not_found', locale: 'en' })

  const site = await cms.site('it')
  expect(site).toMatchObject({ locale: 'it', locales: ['en', 'it'] })

  const item = await host.call<{ id: string }>('POST', '/collections/testimonials/items', {
    body: { locales: {}, data: { quote: { en: 'Great' }, author: 'Ann' } },
  })
  await host.call('POST', `/items/${item.body.id}/publish`)
  const list = await cms.collection('testimonials', { perPage: 5, ids: [item.body.id] })
  expect(list).toMatchObject({ total: 1, perPage: 5, rows: [{ data: { author: 'Ann' } }] })

  const missing = await cms.collection('nope').catch((e: unknown) => e)
  expect(missing).toBeInstanceOf(CmsRequestError)
  expect(missing).toMatchObject({ status: 404 })
})

test('link helpers: system pages, menus and a locale switcher from the alternates', async () => {
  const id = await publish({ en: '/only-english' }, [])
  const pages = await host.call<{ rows: Array<{ id: string; systemKey: string | null }> }>(
    'GET',
    '/pages',
  )
  const contact = pages.body.rows.find((p) => p.systemKey === 'contact')!.id
  await host.publish(contact)
  await host.call('PUT', '/menus/main/draft', {
    body: {
      items: [
        { id: crypto.randomUUID(), label: { en: 'Us' }, link: { type: 'page', id }, children: [] },
      ],
    },
  })
  await host.call('POST', '/menus/main/publish')
  const cms = client()
  const site = await cms.site('en')

  expect(systemPageLink(site, 'contact')).toBe('/contact')
  expect(systemPageLink(site, 'home')).toBeNull()
  expect(menu(site, 'main').map((m) => [m.label, m.href])).toEqual([['Us', '/only-english']])
  expect(menu(site, 'unknown')).toEqual([])

  const resolved = await cms.resolve('/only-english')
  // Italian is missing, so its switcher entry falls back to the Italian homepage.
  expect(localeLinks(site, resolved)).toEqual([
    { locale: 'en', path: '/only-english', current: true },
    { locale: 'it', path: '/it', current: false },
  ])
  const contactPage = await cms.resolve('/it/contatti')
  expect(localeLinks(site, contactPage).map((l) => l.path)).toEqual(['/contact', '/it/contatti'])
  expect(localeLinks(site, contactPage).find((l) => l.current)?.locale).toBe('it')
  // Not found: every locale links to its homepage.
  const missing = await cms.resolve('/missing')
  expect(localeLinks(site, missing).map((l) => l.path)).toEqual(['/', '/it'])
})

test('preview reads a draft with the editor session; anonymous preview is refused', async () => {
  const created = await host.create(
    page({ en: '/draft' }, [section('rich_text', { body: { en: '<p>Draft</p>' } })]),
  )
  const editor = createCmsClient({ fetch: host.fetch, baseUrl: 'https://host.test/api/cms' })
  expect(await editor.previewPage(created.body.id, 'en')).toMatchObject({
    path: '/draft',
    sections: [{ type: 'rich_text', data: { body: '<p>Draft</p>' } }],
  })
  await expect(client().previewPage(created.body.id)).rejects.toMatchObject({ status: 401 })
})
