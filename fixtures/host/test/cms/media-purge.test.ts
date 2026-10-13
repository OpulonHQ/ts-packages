import type { ResolveResult } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { files } from '../media/helpers.ts'
import { page, section, useCmsHost } from './helpers.ts'

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
  expect(host.purged.slice(start).flat().some((tag) => answerTags.includes(tag))).toBe(true)
  const after = await host.call<ResolveResult>('GET', '/resolve?path=/media-purge', { as: null })
  expect(after.body).toMatchObject({
    kind: 'page',
    sections: [{ data: { image: { id: mediaId, alt: 'New alt', caption: 'New caption' } } }],
  })
})
