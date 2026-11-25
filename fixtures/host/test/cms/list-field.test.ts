import {
  defineCms,
  fields,
  type Item,
  type Page,
  type PagePreview,
  type PublicSite,
  type ResolveResult,
  type SiteSettings,
} from '@opulonjs/cms/api'
import { mediaCacheTag } from '@opulonjs/media/api'
import { expect, test } from 'vitest'
import { files } from '../media/helpers.ts'
import { locale, page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const read = <Body>(path: string) => host.call<Body>('GET', path, { as: null })
const resolve = (path: string) => read<ResolveResult>(`/resolve?path=${encodeURIComponent(path)}`)
const tags = (headers: Headers) => (headers.get('cache-tag') ?? '').split(',')
const entry = (data: Record<string, unknown>, id: string = crypto.randomUUID()) => ({ id, data })
const cards = (...items: Array<unknown>) => section('cards', { cards: items })
const unique = (prefix: string) => `/${prefix}-${crypto.randomUUID()}`
const createItem = async (collection: string, body: unknown) => {
  const created = await host.call<Item>('POST', `/collections/${collection}/items`, { body })
  expect(created.status).toBe(200)
  return created.body
}

test('the Read API answers list items in order, localized, with media and links resolved like top-level fields', async () => {
  const lake = await host.upload(files.png(800, 600), 'lake.png', { en: 'A lake', it: 'Un lago' })
  const target = (await host.create(page({ en: unique('target'), it: '/obiettivo-carte' }))).body
  expect((await host.publish(target.id)).status).toBe(200)
  const news = await createItem('categories', { locales: {}, data: { name: { en: 'News' } } })
  const gone = crypto.randomUUID()
  const [first, second] = [crypto.randomUUID(), crypto.randomUUID()]
  const paths = { en: unique('cards'), it: unique('carte') }
  const created = await host.create(
    page(paths, [
      cards(
        entry(
          {
            title: { en: 'One', it: 'Uno' },
            image: lake,
            link: { type: 'page', id: target.id },
            category: news.id,
          },
          first,
        ),
        entry(
          {
            title: { en: 'Two' },
            image: gone,
            link: { type: 'url', url: 'https://example.test/two' },
          },
          second,
        ),
      ),
    ]),
  )
  expect(created.status).toBe(200)
  expect((await host.publish(created.body.id)).status).toBe(200)

  const it = await resolve(`/it${paths.it}`)
  expect(it.body).toMatchObject({ kind: 'page', locale: 'it' })
  const data = it.body.kind === 'page' ? it.body.sections[0]!.data : {}
  expect(data['cards']).toEqual([
    {
      id: first,
      data: {
        title: 'Uno',
        image: expect.objectContaining({ id: lake, alt: 'Un lago', width: 800 }),
        link: { type: 'page', id: target.id, href: '/it/obiettivo-carte' },
        category: news.id,
      },
    },
    {
      id: second,
      data: {
        title: 'Two',
        image: null,
        link: {
          type: 'url',
          url: 'https://example.test/two',
          href: 'https://example.test/two',
        },
      },
    },
  ])
  expect(tags(it.headers)).toEqual(
    expect.arrayContaining([`cms:page:${target.id}`, mediaCacheTag(lake), mediaCacheTag(gone)]),
  )

  const preview = await host.call<PagePreview>('GET', `/pages/${created.body.id}/preview?locale=it`)
  expect(preview.body.sections[0]!.data['cards']).toMatchObject([
    { id: first, data: { title: 'Uno', image: lake } },
    { id: second, data: { title: 'Two' } },
  ])
})

test('collection items and site settings hold lists too', async () => {
  const target = (await host.create(page({ en: unique('office'), it: '/ufficio-roma' }))).body
  expect((await host.publish(target.id)).status).toBe(200)
  const path = unique('faq')
  const post = await createItem('posts', {
    locales: { en: locale(path) },
    data: {
      title: { en: 'Post' },
      faq: [entry({ question: { en: 'Why?' }, answer: { en: '<p>Because.</p>' } })],
    },
  })
  expect((await host.publishDraft(`/items/${post.id}`)).status).toBe(200)
  expect((await resolve(path)).body).toMatchObject({
    kind: 'item',
    data: { faq: [{ data: { question: 'Why?', answer: '<p>Because.</p>' } }] },
  })

  const saved = await host.saveDraft<SiteSettings>('/settings', {
    data: { offices: [entry({ city: 'Rome', map: { it: { type: 'page', id: target.id } } })] },
  })
  expect(saved.status).toBe(200)
  expect((await host.publishDraft('/settings')).status).toBe(200)
  const site = await read<PublicSite>('/site?locale=it')
  expect(site.body.settings['offices']).toMatchObject([
    { data: { city: 'Rome', map: { type: 'page', id: target.id, href: '/it/ufficio-roma' } } },
  ])
  expect(tags(site.headers)).toContain(`cms:page:${target.id}`)
  const english = await read<PublicSite>('/site?locale=en')
  expect(english.body.settings['offices']).toEqual([
    { id: expect.any(String), data: { city: 'Rome', map: null } },
  ])

  await host.saveDraft('/settings', { data: { offices: [entry({})] } })
  const refused = await host.publishDraft('/settings')
  expect(refused.status).toBe(400)
  expect(refused.body).toMatchObject({ message: '"Offices", item 1: "City" is required.' })
  await host.saveDraft('/settings', { data: {} })
  expect((await host.publishDraft('/settings')).status).toBe(200)
})

test('a save cleans item values, keeps ids and order, and replaces ids that are invalid or repeated', async () => {
  const kept = crypto.randomUUID()
  const post = await createItem('posts', {
    locales: {},
    data: {
      title: { en: 'Post' },
      faq: [
        {
          id: kept,
          data: {
            question: { en: 'First?', de: 'Erste?' },
            answer: { en: '<p>Yes</p><script>alert(1)</script>' },
            unknown: 'dropped',
          },
        },
        { id: kept, data: { question: { en: 'Second?' } } },
        { id: 'not-an-id', data: {} },
      ],
    },
  })
  const faq = post.draft.data['faq'] as Array<{ id: string; data: Record<string, unknown> }>
  expect(faq[0]).toEqual({
    id: kept,
    data: { question: { en: 'First?' }, answer: { en: '<p>Yes</p>' } },
  })
  expect(faq[1]!.data).toEqual({ question: { en: 'Second?' } })
  expect(faq[2]!.data).toEqual({})
  expect(new Set(faq.map((item) => item.id)).size).toBe(3)
  for (const item of faq) expect(item.id).toMatch(uuid)

  const reordered = await host.saveDraft<Item>(`/items/${post.id}`, {
    locales: {},
    data: { title: { en: 'Post' }, faq: [faq[2], faq[0], faq[1]] },
  })
  expect(reordered.body.draft.data['faq']).toEqual([faq[2], faq[0], faq[1]])

  const emptied = await host.saveDraft<Item>(`/items/${post.id}`, {
    locales: {},
    data: { title: { en: 'Post' }, faq: [] },
  })
  expect(emptied.body.draft.data).toEqual({ title: { en: 'Post' } })
})

test.each([
  ['more items than the maximum', cards(entry({}), entry({}), entry({}), entry({}), entry({}))],
  ['an item value of the wrong type', cards(entry({ title: { en: 5 } }))],
  ['an item media field without a media id', cards(entry({ image: 'lake.png' }))],
  ['an item that is not an object', cards('card')],
  ['an item without data', cards({ id: crypto.randomUUID() })],
  ['a list that is not an array', section('cards', { cards: { 0: entry({}) } })],
])('%s is refused on save', async (_, bad) => {
  const { status, body } = await host.create(page({ en: unique('bad') }, [bad]))
  expect(status).toBe(400)
  expect(body).toMatchObject({
    _tag: 'CmsInvalid',
    message: expect.stringContaining('Section 1 (Cards)'),
  })
})

test('a link inside an item is checked like a top-level link', async () => {
  const { status, body } = await host.create(
    page({ en: unique('bad-link') }, [cards(entry({ link: { type: 'system', key: 'nope' } }))]),
  )
  expect(status).toBe(400)
  expect(body).toMatchObject({
    message:
      'Section 1 (Cards): "Cards", item 1: "Link": The link points at the unknown system page "nope".',
  })
  const cleaned = await host.create(
    page({ en: unique('url-link') }, [
      cards(entry({ link: { type: 'url', url: '  https://example.test/a  ' } })),
    ]),
  )
  expect(cleaned.body.draft.sections[0]!.data['cards']).toMatchObject([
    { data: { link: { type: 'url', url: 'https://example.test/a' } } },
  ])
})

test('publishing needs the minimum count and every required item field in each available locale', async () => {
  const paths = { en: unique('publish'), it: unique('pubblica') }
  const created = await host.create(page(paths, [section('cards', { heading: { en: 'Cards' } })]))
  const id = created.body.id
  const publish = async (...items: Array<unknown>) => {
    expect((await host.save(id, page(paths, [cards(...items)]))).status).toBe(200)
    return host.publish(id)
  }

  const empty = await host.publish(id)
  expect(empty.status).toBe(400)
  expect(empty.body).toMatchObject({
    message: 'Section 1 (Cards): "Cards" needs at least 1 item.',
  })

  const untitled = await publish(entry({ title: { en: 'One' } }), entry({}))
  expect(untitled.status).toBe(400)
  expect(untitled.body).toMatchObject({
    message: 'Section 1 (Cards): "Cards", item 2: "Title" is required in en.',
  })

  const italianOnly = await publish(entry({ title: { it: 'Uno' } }))
  expect(italianOnly.status).toBe(400)
  expect(italianOnly.body).toMatchObject({
    message: 'Section 1 (Cards): "Cards", item 1: "Title" is required in en.',
  })

  expect((await publish(entry({ title: { en: 'One' } }))).status).toBe(200)
})

test('revisions and restore cover lists', async () => {
  const paths = { en: unique('revisions') }
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  const created = await host.create(
    page(paths, [cards(entry({ title: { en: 'A' } }, a), entry({ title: { en: 'B' } }, b))]),
  )
  const id = created.body.id
  const first = (await host.publish(id)).body
  await host.save(id, page(paths, [cards(entry({ title: { en: 'B, edited' } }, b))]))
  const second = (await host.publish(id)).body

  const view = await host.call<{ document: Page['draft'] }>(
    'GET',
    `/pages/${id}/revisions/${first.publishedRevisionId}`,
  )
  expect(view.body.document.sections[0]!.data['cards']).toEqual([
    { id: a, data: { title: { en: 'A' } } },
    { id: b, data: { title: { en: 'B' } } },
  ])

  const restored = await host.call<Page>(
    'POST',
    `/pages/${id}/revisions/${first.publishedRevisionId}/restore?version=${second.version}`,
  )
  expect(restored.status).toBe(200)
  expect(restored.body.draft).toEqual(first.draft)
  expect((await host.publish(id)).status).toBe(200)
  const live = await resolve(paths.en)
  expect(live.body.kind === 'page' && live.body.sections[0]!.data['cards']).toEqual([
    { id: a, data: { title: 'A' } },
    { id: b, data: { title: 'B' } },
  ])
})

test('a list definition is checked: no list inside an item, sane counts, known collections', () => {
  const item = { title: fields.text({ label: 'Title' }) }
  const inner = fields.list({ label: 'Inner', item })
  expect(() =>
    fields.list({
      label: 'Outer',
      // @ts-expect-error: a list item holds no list
      item: { inner },
    }),
  ).toThrow('the list "Outer" has the list "inner" in its items')
  expect(() => fields.list({ label: 'Empty', item: {} })).toThrow(
    'the list "Empty" needs at least one item field',
  )
  for (const [min, max] of [
    [3, 2],
    [-1, 2],
    [0, 101],
    [1.5, 4],
  ])
    expect(() => fields.list({ label: 'Counted', item, min, max })).toThrow(
      'the list "Counted" needs whole item counts with 0 <= min <= max <= 100',
    )
  expect(() =>
    defineCms({
      sections: {
        cards: {
          label: 'Cards',
          fields: {
            cards: fields.list({
              label: 'Cards',
              item: { tag: fields.reference({ label: 'Tag', collection: 'tags' }) },
            }),
          },
        },
      },
      systemPages: {},
    }),
  ).toThrow('field "cards.tag" of section type "cards" references the unknown collection "tags"')
})

test('a template may prefill a list, checked against the item fields', () => {
  const sections = {
    cards: {
      label: 'Cards',
      fields: {
        cards: fields.list({
          label: 'Cards',
          item: {
            title: fields.text({ label: 'Title' }),
            link: fields.link({ label: 'Link' }),
          },
        }),
      },
    },
  }
  const template = (data: Record<string, unknown>) =>
    defineCms({
      sections,
      systemPages: {},
      templates: { landing: { label: 'Landing', sections: [{ type: 'cards', data }] } },
    })
  expect(() => template({ cards: [entry({ title: { en: 'One' } })] })).not.toThrow()
  expect(() => template({ cards: [entry({ title: 5 })] })).toThrow('has invalid data')
  expect(() => template({ cards: [entry({ link: { type: 'system', key: 'nope' } })] })).toThrow(
    'unknown system page "nope"',
  )
})
