import type { MediaItem } from '@opulonjs/media/api'
import { expect, test } from 'vitest'
import { adminQuery } from '../../../../test/postgres/admin.ts'
import { files, useHost } from './helpers.ts'

const host = useHost()

const events = (id: string) =>
  adminQuery<{ action: string; changes: unknown }>(
    host.db.url,
    `select action, changes from core.audit_event where subject_id = '${id}' order by id`,
  )
const list = async (query = '') =>
  (await host.call<{ rows: Array<MediaItem>; total: number }>('GET', `/api/media/items${query}`))
    .body

test('replace keeps the id, bumps the version and URL, and the old URL keeps serving', async () => {
  const first = (await host.upload(files.png(100, 50), 'banner.png', 'image/png')).body
  const replaced = await host.replace(first.id, files.jpeg(400, 200), 'banner-v2.jpg', 'image/jpeg')
  expect(replaced.status).toBe(200)
  expect(replaced.body).toMatchObject({
    id: first.id,
    version: 2,
    filename: 'banner-v2.jpg',
    mime: 'image/jpeg',
    width: 400,
    height: 200,
    url: `/media/${first.id}/2/banner-v2.jpg`,
  })
  expect((await host.call('GET', first.url)).bytes).toEqual(files.png(100, 50))
  expect((await host.call('GET', replaced.body.url)).bytes).toEqual(files.jpeg(400, 200))
  expect((await host.call('GET', `/api/media/items/${first.id}`)).body).toEqual(replaced.body)
  expect(await events(first.id)).toEqual([
    { action: 'media.item.uploaded', changes: null },
    {
      action: 'media.item.replaced',
      changes: [
        { field: 'version', from: 1, to: 2 },
        { field: 'filename', from: 'banner.png', to: 'banner-v2.jpg' },
        { field: 'mime', from: 'image/png', to: 'image/jpeg' },
        { field: 'size', from: files.png(1, 1).length, to: files.jpeg(1, 1).length },
      ],
    },
  ])
})

test('replace validates the new file and needs an existing item', async () => {
  const item = (await host.upload(files.png(1, 1), 'a.png', 'image/png')).body
  expect(await host.replace(item.id, files.svg(), 'a.svg', 'image/svg+xml')).toMatchObject({
    status: 400,
    body: { reason: 'unsupported_type' },
  })
  expect((await host.call('GET', `/api/media/items/${item.id}`)).body).toMatchObject({ version: 1 })
  const missing = await host.replace(crypto.randomUUID(), files.png(1, 1), 'a.png', 'image/png')
  expect(missing.status).toBe(404)
})

test('alt text and captions are edited per content locale; other locales are dropped', async () => {
  const item = (await host.upload(files.png(1, 1), 'lake.png', 'image/png')).body
  const update = (payload: object) =>
    host.call<MediaItem>('PATCH', `/api/media/items/${item.id}`, { body: JSON.stringify(payload) })
  expect(
    (
      await update({
        alt: { en: ' A lake ', it: 'Un lago', de: 'Ein See' },
        caption: { en: 'Como' },
      })
    ).body,
  ).toMatchObject({ alt: { en: 'A lake', it: 'Un lago' }, caption: { en: 'Como' } })
  // Omitted fields stay; an empty value removes the locale.
  expect((await update({ alt: { en: 'A lake', it: '' } })).body).toMatchObject({
    alt: { en: 'A lake' },
    caption: { en: 'Como' },
  })
  expect((await events(item.id)).map((e) => e.changes)).toEqual([
    null,
    [
      { field: 'alt.en', from: null, to: 'A lake' },
      { field: 'caption.en', from: null, to: 'Como' },
      { field: 'alt.it', from: null, to: 'Un lago' },
    ],
    [{ field: 'alt.it', from: 'Un lago', to: null }],
  ])
  const denied = await host.call('PATCH', `/api/media/items/${item.id}`, {
    body: '{}',
    as: ['media.view'],
  })
  expect(denied.status).toBe(403)
})

test('archive hides an item from the library while its URL keeps serving; restore brings it back', async () => {
  const item = (await host.upload(files.pdf(), 'old-menu.pdf', 'application/pdf')).body
  expect((await list()).rows.map((r) => r.id)).toContain(item.id)

  expect(
    (
      await host.call('POST', `/api/media/items/${item.id}/archive`, {
        as: ['media.view', 'media.upload'],
      })
    ).status,
  ).toBe(403)
  const archived = await host.call<MediaItem>('POST', `/api/media/items/${item.id}/archive`)
  expect(archived.body.archivedAt).toEqual(expect.any(String))
  expect((await list()).rows.map((r) => r.id)).not.toContain(item.id)
  expect((await list('?status=archived')).rows.map((r) => r.id)).toEqual([item.id])
  expect(await host.call('GET', item.url)).toMatchObject({ status: 200, bytes: files.pdf() })

  const restored = await host.call<MediaItem>('POST', `/api/media/items/${item.id}/restore`)
  expect(restored.body.archivedAt).toBeNull()
  expect((await list()).rows.map((r) => r.id)).toContain(item.id)
  expect((await events(item.id)).map((e) => e.action)).toEqual([
    'media.item.uploaded',
    'media.item.archived',
    'media.item.restored',
  ])
})

test('the library searches filename and alt text, filters by type and pages', async () => {
  await adminQuery(host.db.url, 'update media.item set archived_at = now()')
  const photo = (await host.upload(files.jpeg(10, 10), 'Sunset.jpg', 'image/jpeg')).body
  await host.call('PATCH', `/api/media/items/${photo.id}`, {
    body: JSON.stringify({ alt: { it: 'Tramonto sul lago' } }),
  })
  const brochure = (await host.upload(files.pdf(), 'brochure.pdf', 'application/pdf')).body
  const logo = (await host.upload(files.png(1, 1), 'logo.png', 'image/png')).body

  expect(await list()).toMatchObject({
    total: 3,
    rows: [{ id: logo.id }, { id: brochure.id }, { id: photo.id }],
  })
  expect((await list('?search=TRAMONTO')).rows.map((r) => r.id)).toEqual([photo.id])
  expect((await list('?search=sunset')).rows.map((r) => r.id)).toEqual([photo.id])
  expect((await list('?type=pdf')).rows.map((r) => r.id)).toEqual([brochure.id])
  expect((await list('?type=image')).rows.map((r) => r.id)).toEqual([logo.id, photo.id])
  expect(await list('?perPage=2&page=2')).toMatchObject({ total: 3, rows: [{ id: photo.id }] })
  expect((await host.call('GET', '/api/media/items', { as: ['demo.notes.view'] })).status).toBe(403)
})

test('an unknown or malformed id is not found', async () => {
  expect((await host.call('GET', `/api/media/items/${crypto.randomUUID()}`)).status).toBe(404)
  expect((await host.call('GET', '/api/media/items/not-a-uuid')).status).toBe(404)
})
