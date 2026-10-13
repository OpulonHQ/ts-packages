import type { PagePreview } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
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

test('preview needs a signed-in user with cms.pages.view', async () => {
  const created = (await host.create(page({ en: '/secret' }))).body
  const path = `/pages/${created.id}/preview`
  expect((await host.call('GET', path, { as: null })).status).toBe(401)
  expect((await host.call('GET', path, { as: ['media.view'] })).status).toBe(403)
  expect((await host.call('GET', path, { as: ['cms.pages.view'] })).status).toBe(200)
})
