import type { Item, ResolveResult } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { files } from '../media/helpers.ts'
import { locale, page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

test('editing media metadata purges the cached Read API answer that resolved it', async () => {
  const mediaId = await host.upload(files.png(800, 600), 'lake.png', { en: 'Old alt' })
  const created = await host.create(
    page({ en: '/media-purge' }, [section('hero', { title: { en: 'Lake' }, image: mediaId })]),
  )
  expect(created.status).toBe(200)
  expect((await host.publish(created.body.id)).status).toBe(200)
  const before = await host.call<ResolveResult>('GET', '/resolve?path=/media-purge', { as: null })
  expect(before.body).toMatchObject({
    kind: 'page',
    sections: [{ data: { image: { id: mediaId, alt: 'Old alt' } } }],
  })
  const answerTags = (before.headers.get('cache-tag') ?? '').split(',')
  expect(answerTags).toContain(`cms:page:${created.body.id}`)
  const start = host.purged.length
  const changed = await host.fetch(`https://host.test/api/media/items/${mediaId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alt: { en: 'New alt' }, caption: { en: 'New caption' } }),
  })
  expect(changed.status).toBe(200)
  expect(
    host.purged
      .slice(start)
      .flat()
      .some((tag) => answerTags.includes(tag)),
  ).toBe(true)
  const after = await host.call<ResolveResult>('GET', '/resolve?path=/media-purge', { as: null })
  expect(after.body).toMatchObject({
    kind: 'page',
    sections: [{ data: { image: { id: mediaId, alt: 'New alt', caption: 'New caption' } } }],
  })
})

test('replacement and archive purge the Read API media tag and its overflow fallback', async () => {
  const id = await host.upload(files.png(800, 600), 'replace.png')
  const created = await host.create(
    page({ en: '/media-replace' }, [
      section('hero', {
        title: { en: 'Image' },
        image: id,
      }),
    ]),
  )
  await host.publish(created.body.id)
  const before = await host.call<ResolveResult>('GET', '/resolve?path=/media-replace', { as: null })
  expect(before.headers.get('cache-tag')?.split(',')).toContain(`media:${id}`)
  const start = host.purged.length
  const file = new FormData()
  file.append('file', new File([files.png(1200, 900).slice()], 'new.png', { type: 'image/png' }))
  expect(
    (
      await host.fetch(`https://host.test/api/media/items/${id}/file`, {
        method: 'PUT',
        body: await new Response(file).blob(),
      })
    ).status,
  ).toBe(200)
  expect(host.purged.slice(start)).toEqual([[`media:${id}`, 'media']])
  const after = await host.call<ResolveResult>('GET', '/resolve?path=/media-replace', { as: null })
  expect(after.body).toMatchObject({
    kind: 'page',
    sections: [{ data: { image: { url: `/media/${id}/2/new.png`, width: 1200 } } }],
  })
  const archived = host.purged.length
  expect(
    (await host.fetch(`https://host.test/api/media/items/${id}/archive`, { method: 'POST' }))
      .status,
  ).toBe(200)
  expect(host.purged.slice(archived)).toEqual([[`media:${id}`, 'media']])
  const restored = host.purged.length
  expect(
    (await host.fetch(`https://host.test/api/media/items/${id}/restore`, { method: 'POST' }))
      .status,
  ).toBe(200)
  expect(host.purged.slice(restored)).toEqual([[`media:${id}`, 'media']])
})

test('page SEO, collection lists, routed items and unresolved media ids carry media dependencies', async () => {
  const id = await host.upload(files.png(800, 600), 'cover.png')
  const missing = crypto.randomUUID()
  const draft = page({ en: '/media-seo' }, [
    section('hero', {
      title: { en: 'Missing image' },
      image: missing,
    }),
  ])
  const created = await host.create({
    ...draft,
    locales: {
      en: {
        ...locale('/media-seo'),
        seo: { ...locale('/media-seo').seo, image: id },
      },
    },
  })
  expect((await host.publish(created.body.id)).status).toBe(200)
  const answer = await host.call<ResolveResult>('GET', '/resolve?path=/media-seo', { as: null })
  expect(answer.headers.get('cache-tag')?.split(',')).toEqual(
    expect.arrayContaining([`media:${id}`, `media:${missing}`]),
  )
  expect(answer.body).toMatchObject({ kind: 'page', sections: [{ data: { image: null } }] })
  const item = await host.call<Item>('POST', '/collections/posts/items', {
    body: { locales: { en: locale('/media-post') }, data: { title: { en: 'Post' }, cover: id } },
  })
  expect((await host.publishDraft(`/items/${item.body.id}`)).status).toBe(200)
  for (const path of ['/collections/posts', '/resolve?path=/media-post']) {
    const read = await host.call('GET', path, { as: null })
    expect(read.status).toBe(200)
    expect(read.headers.get('cache-tag')?.split(',')).toContain(`media:${id}`)
  }
  expect((await host.saveDraft('/settings', { data: { defaultImage: id } })).status).toBe(200)
  expect((await host.publishDraft('/settings')).status).toBe(200)
  const site = await host.call('GET', '/site', { as: null })
  expect(site.headers.get('cache-tag')?.split(',')).toContain(`media:${id}`)
})

test('oversized media dependency headers collapse to the tag every media mutation purges', async () => {
  const sections = Array.from({ length: 200 }, () =>
    section('hero', {
      title: { en: 'Missing image' },
      image: crypto.randomUUID(),
    }),
  )
  const created = await host.create(page({ en: '/media-overflow' }, sections))
  expect(created.status).toBe(200)
  expect((await host.publish(created.body.id)).status).toBe(200)
  const read = await host.call('GET', '/resolve?path=/media-overflow', { as: null })
  expect(read.status).toBe(200)
  expect(read.headers.get('cache-tag')).toBe('cms,cms:routes,media')
  expect(read.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
})
