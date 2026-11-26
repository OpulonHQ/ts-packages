import type { PagePreview } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { files } from '../media/helpers.ts'
import { locale, page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

test('preview shows the draft in one locale, falling back to the default, never cached', async () => {
  const draft = page({ en: '/menu' }, [
    section('hero', { title: { en: 'Menu', it: 'Il menù' }, tone: 'light' }),
    section('rich_text', { body: { en: '<p>Only in English</p>' } }),
  ])
  const it = locale('/menu', {
    seo: { title: 'Menù', description: '', image: null, noindex: true },
  })
  const created = (await host.create({ ...draft, locales: { ...draft.locales, it } })).body

  const { status, headers, body } = await host.call<PagePreview>(
    'GET',
    `/pages/${created.id}/preview?locale=it`,
  )
  expect(status).toBe(200)
  expect(headers.get('cache-control')).toBe('private, no-store')
  expect(body).toMatchObject({
    locale: 'it',
    path: '/menu',
    seo: { title: 'Menù', noindex: true },
    sections: [
      { type: 'hero', data: { title: 'Il menù', tone: 'light' } },
      { type: 'rich_text', data: { body: '<p>Only in English</p>' } },
    ],
  })
  // Unpublished: the public never sees it; nothing was published.
  expect(created.published).toBeNull()

  const fallback = await host.call<PagePreview>('GET', `/pages/${created.id}/preview?locale=de`)
  expect(fallback.body.locale).toBe('en')
})

test('preview resolves media and links like the Read API, at the top level and inside list items', async () => {
  const lake = await host.upload(files.png(800, 600), 'lake.png', { en: 'A lake' })
  const target = (await host.create(page({ en: '/preview-target' }))).body.id
  expect((await host.publish(target)).status).toBe(200)
  const link = { type: 'page', id: target }
  const created = (
    await host.create(
      page({ en: '/preview-resolved' }, [
        section('hero', { title: { en: 'Resolved' }, image: lake }),
        section('cards', {
          more: link,
          cards: [{ id: crypto.randomUUID(), data: { image: lake, link } }],
        }),
      ]),
    )
  ).body
  const media = { id: lake, url: `/media/${lake}/1/lake.png`, alt: 'A lake', mime: 'image/png' }
  const resolved = { ...link, href: '/preview-target' }
  const { body } = await host.call<PagePreview>('GET', `/pages/${created.id}/preview`)
  expect(body.sections.map((s) => s.data)).toMatchObject([
    { title: 'Resolved', image: media },
    { more: resolved, cards: [{ id: expect.any(String), data: { image: media, link: resolved } }] },
  ])
})

test('preview needs a signed-in user with cms.pages.view', async () => {
  const created = (await host.create(page({ en: '/secret' }))).body
  const path = `/pages/${created.id}/preview`
  expect((await host.call('GET', path, { as: null })).status).toBe(401)
  expect((await host.call('GET', path, { as: ['media.view'] })).status).toBe(403)
  expect((await host.call('GET', path, { as: ['cms.pages.view'] })).status).toBe(200)
  const body = page({ en: '/secret' })
  expect((await host.call('POST', path, { body, as: null })).status).toBe(401)
  expect((await host.call('POST', path, { body, as: ['media.view'] })).status).toBe(403)
  expect((await host.call('POST', path, { body, as: ['cms.pages.view'] })).status).toBe(200)
  expect((await host.call('POST', `/pages/${crypto.randomUUID()}/preview`, { body })).status).toBe(
    404,
  )
})
