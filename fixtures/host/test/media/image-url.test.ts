import { PgFromHyperdrive } from '@opulonjs/core/workers'
import { ImageUrl, MediaLibrary, R2MediaStorage, srcset } from '@opulonjs/media/server'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { server } from '../../server/opulon.ts'
import { files, useHost } from './helpers.ts'

const host = useHost()

test('ImageUrl builds Cloudflare /cdn-cgi/image URLs', () => {
  expect(ImageUrl.cloudflare.url('/media/x/1/a.jpg', 640)).toBe(
    '/cdn-cgi/image/width=640,format=auto/media/x/1/a.jpg',
  )
})

test('srcset lists the host widths below the original plus the original, never upscaling', () => {
  const url = (w: number) => `/cdn-cgi/image/width=${w},format=auto/a.jpg`
  expect(srcset(ImageUrl.cloudflare, '/a.jpg', 1000, [1280, 320, 640])).toBe(
    `${url(320)} 320w, ${url(640)} 640w, ${url(1000)} 1000w`,
  )
  expect(srcset(ImageUrl.cloudflare, '/a.jpg', 640, [320, 640])).toBe(
    `${url(320)} 320w, ${url(640)} 640w`,
  )
  expect(srcset(ImageUrl.cloudflare, '/a.pdf', null, [320])).toBe('')
})

/** What cms runs server-side: MediaLibrary from the composed services, over the host's infra. */
const resolve = (ids: ReadonlyArray<string>, locale: string) =>
  Effect.runPromise(
    Effect.flatMap(MediaLibrary, (library) => library.resolve(ids, locale)).pipe(
      Effect.provide(
        // Safe: server.services erases its types; the fixture composes media, so it provides
        // MediaLibrary once given the infra below.
        server.services.pipe(
          Layer.provide(
            Layer.mergeAll(
              PgFromHyperdrive({ connectionString: host.db.url }),
              R2MediaStorage(host.bucket),
            ),
          ),
        ) as Layer.Layer<MediaLibrary>,
      ),
      Effect.scoped,
    ),
  )

test('MediaLibrary.resolve gives { url, alt, width, height, mime, srcset } in a content locale', async () => {
  const photo = (await host.upload(files.jpeg(1000, 600), 'lake.jpg', 'image/jpeg')).body
  await host.call('PATCH', `/api/media/items/${photo.id}`, {
    body: JSON.stringify({ alt: { en: 'A lake', it: 'Un lago' }, caption: { en: 'Como' } }),
  })
  const pdf = (await host.upload(files.pdf(), 'menu.pdf', 'application/pdf')).body
  await host.call('POST', `/api/media/items/${pdf.id}/archive`)

  const it = await resolve([photo.id, pdf.id, crypto.randomUUID(), 'junk'], 'it')
  const cf = (w: number) => `/cdn-cgi/image/width=${w},format=auto${photo.url}`
  expect(it.get(photo.id)).toEqual({
    id: photo.id,
    url: photo.url,
    alt: 'Un lago',
    // Missing in it: falls back to the default content locale (en).
    caption: 'Como',
    width: 1000,
    height: 600,
    mime: 'image/jpeg',
    // The fixture's widths: 320, 640, 1280.
    srcset: `${cf(320)} 320w, ${cf(640)} 640w, ${cf(1000)} 1000w`,
  })
  // Archived items still resolve (their URLs keep serving); unknown ids are absent.
  expect(it.get(pdf.id)).toMatchObject({ url: pdf.url, alt: '', caption: null, srcset: '' })
  expect(it.size).toBe(2)
})
