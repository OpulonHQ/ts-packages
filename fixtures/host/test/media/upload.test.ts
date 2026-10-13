import { authorization, composeServer, core } from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { media, R2MediaStorage } from '@opulonjs/media/server'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { adminQuery } from '../../../../test/postgres/admin.ts'
import { memoryBucket } from '../memory-bucket.ts'
import { files, multipart, useHost } from './helpers.ts'

const host = useHost()

test.each([
  ['image/jpeg', files.jpeg(1200, 800), 'Lake Como.JPG', 'lake-como.jpg', 1200, 800],
  ['image/png', files.png(640, 480), 'logo.png', 'logo.png', 640, 480],
  ['image/webp', files.webp(300, 200), 'photo.webp', 'photo.webp', 300, 200],
  ['image/avif', files.avif(2000, 1000), 'hero.avif', 'hero.avif', 2000, 1000],
  ['image/gif', files.gif(16, 9), 'anim.gif', 'anim.gif', 16, 9],
  ['application/pdf', files.pdf(), 'Cenník 2026.pdf', 'cennik-2026.pdf', null, null],
])(
  'uploads %s with its size and dimensions',
  async (mime, bytes, name, filename, width, height) => {
    const response = await host.upload(bytes, name, mime)
    expect(response.status).toBe(200)
    const item = response.body
    expect(item).toMatchObject({
      version: 1,
      filename,
      mime,
      size: bytes.length,
      width,
      height,
      alt: {},
      caption: {},
      url: `/media/${item.id}/1/${filename}`,
      archivedAt: null,
    })
    expect(host.bucket.keys()).toContain(`${item.id}/1/${filename}`)
    expect(
      await adminQuery(
        host.db.url,
        `select action, actor_id, subject_id, subject_label from core.audit_event
       where subject_id = '${item.id}'`,
      ),
    ).toEqual([
      {
        action: 'media.item.uploaded',
        actor_id: expect.any(String),
        subject_id: item.id,
        subject_label: filename,
      },
    ])
  },
)

test('the extension follows the content, not the uploaded name', async () => {
  const response = await host.upload(files.png(1, 1), 'shot.jpeg.exe', 'application/octet-stream')
  expect(response.body).toMatchObject({ filename: 'shot-jpeg.png', mime: 'image/png' })
})

test.each([
  ['SVG', files.svg(), 'logo.svg', 'image/svg+xml', 'unsupported_type'],
  ['video', files.mp4(), 'clip.mp4', 'video/mp4', 'unsupported_type'],
  ['unknown bytes', files.html(), 'page.bin', 'application/octet-stream', 'unsupported_type'],
  ['HTML declared as PNG', files.html(), 'evil.png', 'image/png', 'type_mismatch'],
  ['JPEG declared as PNG', files.jpeg(10, 10), 'photo.png', 'image/png', 'type_mismatch'],
  ['a truncated PNG', files.png(10, 10).slice(0, 12), 'cut.png', 'image/png', 'type_mismatch'],
])('rejects %s with a clear error and stores nothing', async (_, bytes, name, type, reason) => {
  const before = host.bucket.keys().length
  const response = await host.upload(bytes, name, type)
  expect(response.status).toBe(400)
  expect(response.body).toMatchObject({
    _tag: 'MediaRejected',
    reason,
    message: expect.stringMatching(/\S/),
  })
  expect(host.bucket.keys().length).toBe(before)
})

test('rejects a file over the 20 MB default limit', async () => {
  const big = new Uint8Array(20 * 1024 * 1024 + 1)
  big.set(files.png(10, 10))
  const response = await host.upload(big, 'big.png', 'image/png')
  expect(response.status).toBe(400)
  expect(response.body).toEqual({
    _tag: 'MediaRejected',
    reason: 'too_large',
    message: 'The file is larger than the 20 MB limit.',
  })
})

test('rejects a request without a file part', async () => {
  const response = await host.call('POST', '/api/media/items', { body: new FormData() })
  expect(response.status).toBe(400)
  expect(response.body).toMatchObject({ reason: 'missing_file' })
})

test('upload needs media.upload', async () => {
  const response = await host.upload(files.png(1, 1), 'a.png', 'image/png', ['media.view'])
  expect(response.status).toBe(403)
  expect(await host.call('POST', '/api/media/items', { as: null })).toMatchObject({ status: 401 })
})

test('the size limit is a host option', async () => {
  const bucket = memoryBucket()
  const worker = createWorker(composeServer({ modules: [core(), media({ maxBytes: 100 })] }), {
    infra: (env: { url: string }) =>
      Layer.mergeAll(
        PgFromHyperdrive({ connectionString: env.url }),
        R2MediaStorage(bucket),
        authorization(() =>
          Effect.succeed({
            id: 'u1',
            name: 'Uploader',
            email: 'u@example.test',
            locale: null,
            permissions: ['media.upload'],
          }),
        ),
      ),
    buildId: () => 'test',
  })
  const upload = async (bytes: Uint8Array) => {
    const body = new FormData()
    body.append('file', new Blob([bytes.slice()], { type: 'image/png' }), 'a.png')
    const headers = new Headers()
    const response = await worker.fetch(
      new Request('https://host.test/api/media/items', {
        method: 'POST',
        headers,
        body: await multipart(body, headers),
      }),
      { url: host.db.url },
      { waitUntil: () => {} },
    )
    return { status: response.status, body: await response.json() }
  }
  expect((await upload(files.png(2, 2))).status).toBe(200)
  const big = new Uint8Array(101)
  big.set(files.png(2, 2))
  expect(await upload(big)).toMatchObject({
    status: 400,
    body: { reason: 'too_large', message: 'The file is larger than the 100 bytes limit.' },
  })
})
