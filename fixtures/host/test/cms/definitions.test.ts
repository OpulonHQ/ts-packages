import { defineCms, fields } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const imageId = '0b5e8f9e-2d4f-4c8e-9a51-7f0e3c1d2a4b'

test('a draft is validated and normalized against the host definitions', async () => {
  const { status, body } = await host.create(
    page({ en: '/about', it: '/chi-siamo' }, [
      section('hero', {
        title: { en: 'About us', it: 'Chi siamo', de: 'Über uns' },
        image: imageId,
        tone: 'dark',
        accent: '#ff8800',
        unknown: 'dropped',
      }),
      section('stats', { count: 12, visible: true, note: 'Plain' }),
    ]),
  )
  expect(status).toBe(200)
  expect(body.draft.sections.map((s) => s.data)).toEqual([
    // Locales outside the host's content locales and undeclared fields are dropped.
    { title: { en: 'About us', it: 'Chi siamo' }, image: imageId, tone: 'dark', accent: '#ff8800' },
    { count: 12, visible: true, note: 'Plain' },
  ])
  expect(Object.keys(body.draft.locales)).toEqual(['en', 'it'])
  expect(body.status).toBe('draft')
})

test.each([
  ['an unknown section type', section('carousel', {}), 'unknown type "carousel"'],
  ['a value of the wrong type', section('stats', { count: 'many' }), 'Section 1 (Stats)'],
  ['a number out of bounds', section('stats', { count: 5000 }), 'Section 1 (Stats)'],
  ['an option not offered', section('hero', { tone: 'neon' }), 'Section 1 (Hero)'],
  ['a custom field failing its schema', section('hero', { accent: 'red' }), 'Section 1 (Hero)'],
  ['a media field without a media id', section('hero', { image: 'x.png' }), 'Section 1 (Hero)'],
  ['text over its maximum length', section('hero', { title: { en: 'x'.repeat(121) } }), 'Hero'],
])('%s is refused with a message for the editor', async (_, bad, message) => {
  const { status, body } = await host.create(page({ en: `/bad-${crypto.randomUUID()}` }, [bad]))
  expect(status).toBe(400)
  expect(body).toMatchObject({ _tag: 'CmsInvalid', message: expect.stringContaining(message) })
})

test('paths are checked per locale and must be unique among pages', async () => {
  const invalid = await host.create(page({ en: 'About Us' }))
  expect(invalid.status).toBe(400)
  expect(invalid.body).toMatchObject({ message: expect.stringContaining('must start with "/"') })

  const missing = await host.create({
    locales: { en: { ...page({ en: '' }).locales.en!, available: true } },
    sections: [],
  })
  expect(missing.body).toMatchObject({ message: expect.stringContaining('needs a en path') })

  expect((await host.create(page({ en: '/team' }))).status).toBe(200)
  const taken = await host.create(page({ en: '/team' }))
  expect(taken.status).toBe(409)
  expect(taken.body).toMatchObject({ _tag: 'CmsConflict', reason: 'path_taken' })
  // The same path in another locale is a different URL.
  expect((await host.create(page({ en: '/staff', it: '/team' }))).status).toBe(200)
})

test('system pages exist from the start, can be edited, but not deleted', async () => {
  const { body } = await host.call<{
    rows: Array<{ id: string; systemKey: string | null; title: string; path: string }>
  }>('GET', '/pages')
  const home = body.rows.find((r) => r.systemKey === 'home')!
  expect(home).toMatchObject({ title: 'Homepage', path: '/' })
  expect(body.rows.find((r) => r.systemKey === 'contact')).toMatchObject({ path: '/contact' })

  const edited = await host.save(
    home.id,
    page({ en: '/' }, [section('rich_text', { body: { en: '<p>Hi</p>' } })]),
  )
  expect(edited.status).toBe(200)
  const deleted = await host.call('DELETE', `/pages/${home.id}`)
  expect(deleted.status).toBe(409)
  expect(deleted.body).toMatchObject({ reason: 'system_page' })

  const own = (await host.create(page({ en: '/temporary' }))).body
  expect((await host.call('DELETE', `/pages/${own.id}`)).status).toBe(204)
  expect((await host.call('GET', `/pages/${own.id}`)).status).toBe(404)
})

test('definition keys must be valid identifiers', () => {
  expect(() =>
    defineCms({ sections: { 'Hero Block': { label: 'x', fields: {} } }, systemPages: {} }),
  ).toThrow('"Hero Block" is not a valid key')
})

test('references must name a defined collection; title fields must be fields', () => {
  expect(() =>
    defineCms({
      sections: {},
      systemPages: {},
      collections: {
        posts: {
          label: 'Posts',
          fields: { tags: fields.reference({ label: 'Tags', collection: 'tags' }) },
        },
      },
    }),
  ).toThrow('field "tags" of collection "posts" references the unknown collection "tags"')
  expect(() =>
    defineCms({
      sections: {},
      systemPages: {},
      collections: { team: { label: 'Team', titleField: 'name', fields: {} } },
    }),
  ).toThrow('the title field "name" of collection "team" is not a field')
})
