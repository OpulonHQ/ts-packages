import { defineCms, fields, type PageTemplate, type SectionType } from '@opulonjs/cms/api'
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

const hostSections: Record<string, SectionType> = {
  hero: { label: 'Hero', fields: { title: fields.text({ label: 'Title', maxLength: 20 }) } },
  cta: {
    label: 'Call to action',
    fields: {
      link: fields.link({ label: 'Link' }),
      links: fields.link({ label: 'Links', localized: true }),
    },
  },
}
const templated = (sections: PageTemplate['sections']) =>
  defineCms({
    sections: hostSections,
    systemPages: { home: { label: 'Home', paths: { en: '/' } } },
    templates: { landing: { label: 'Landing', sections } },
  })

test('templates prefill sections in the stored shape and are kept on the definitions', () => {
  const sections = [
    { type: 'hero', data: { title: { en: 'Welcome' } } },
    { type: 'rich_text', data: { body: { en: '<p>Hi</p>' } } },
    { type: 'hero' },
    {
      type: 'cta',
      data: {
        link: { type: 'system', key: 'home' },
        links: { en: { type: 'url', url: 'https://example.com' }, sk: null },
      },
    },
    ...Array.from({ length: 196 }, () => ({ type: 'hero' })),
  ]
  expect(templated(sections).templates).toEqual({ landing: { label: 'Landing', sections } })
  expect(defineCms({ sections: {}, systemPages: {} }).templates).toEqual({})
})

test.each([
  [
    'an unknown section type',
    [{ type: 'carousel' }],
    'template "landing", section 1 names the unknown section type "carousel"',
  ],
  [
    'data failing a field schema',
    [{ type: 'hero', data: { title: { en: 'x'.repeat(21) } } }],
    'template "landing", section 1 ("hero") has invalid data',
  ],
  [
    'a localized field holding a plain value',
    [{ type: 'rich_text' }, { type: 'hero', data: { title: 'Welcome' } }],
    'template "landing", section 2 ("hero") has invalid data',
  ],
  [
    'a field the section type does not have',
    [{ type: 'hero', data: { subtitle: { en: 'Hi' } } }],
    'template "landing", section 1 ("hero") has invalid data',
  ],
  [
    'more sections than a page holds',
    Array.from({ length: 201 }, () => ({ type: 'hero' })),
    'template "landing" has 201 sections; a page holds at most 200',
  ],
  [
    'a URL link without an allowed prefix',
    [{ type: 'cta', data: { link: { type: 'url', url: 'javascript:alert(1)' } } }],
    'template "landing", section 1 ("cta") field "link": The link URL "javascript:alert(1)" must start with',
  ],
  [
    'a link to an unknown system page',
    [{ type: 'rich_text' }, { type: 'cta', data: { link: { type: 'system', key: 'blog' } } }],
    'template "landing", section 2 ("cta") field "link": The link points at the unknown system page "blog".',
  ],
  [
    'a localized page link whose id is not a uuid',
    [{ type: 'cta', data: { links: { en: { type: 'page', id: 'about' } } } }],
    'template "landing", section 1 ("cta") field "links": The link points at no page.',
  ],
])('a template with %s fails composition', (_, sections, message) => {
  expect(() => templated(sections)).toThrow(message)
})

test('template keys must be valid identifiers', () => {
  expect(() =>
    defineCms({
      sections: {},
      systemPages: {},
      templates: { 'Landing Page': { label: 'Landing', sections: [] } },
    }),
  ).toThrow('"Landing Page" is not a valid key')
})
