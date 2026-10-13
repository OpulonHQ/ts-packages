import { expect, test } from 'vitest'
import { files, useHost } from './helpers.ts'

const host = useHost()

test('serves the original with immutable caching, no auth needed', async () => {
  const item = (await host.upload(files.webp(64, 32), 'Hero.webp', 'image/webp')).body
  const response = await host.call('GET', item.url, { as: null })
  expect(response.status).toBe(200)
  expect(response.bytes).toEqual(files.webp(64, 32))
  expect(Object.fromEntries(response.headers)).toMatchObject({
    'content-type': 'image/webp',
    'content-length': String(files.webp(64, 32).length),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline; filename="hero.webp"',
    etag: expect.any(String),
  })
})

test('HEAD answers headers only', async () => {
  const item = (await host.upload(files.pdf(), 'menu.pdf', 'application/pdf')).body
  const response = await host.call('HEAD', item.url, { as: null })
  expect(response).toMatchObject({ status: 200, bytes: new Uint8Array() })
  expect(response.headers.get('content-type')).toBe('application/pdf')
  expect(response.headers.get('content-length')).toBe(String(files.pdf().length))
})

test('unknown, mismatched or malformed paths are 404 and not cached', async () => {
  const item = (await host.upload(files.png(1, 1), 'a.png', 'image/png')).body
  for (const path of [
    `/media/${item.id}/1/other.png`,
    `/media/${item.id}/2/a.png`,
    `/media/${item.id}/01/a.png`,
    `/media/${crypto.randomUUID()}/1/a.png`,
    `/media/${item.id}/1/..%2fa.png`,
    `/media/${item.id}/1`,
    '/media/',
  ]) {
    const response = await host.call('GET', path, { as: null })
    expect([path, response.status, response.headers.get('cache-control')]).toEqual([
      path,
      404,
      'no-store',
    ])
  }
})

test('only GET and HEAD', async () => {
  const item = (await host.upload(files.png(1, 1), 'a.png', 'image/png')).body
  const response = await host.call('POST', item.url, { as: null })
  expect(response.status).toBe(405)
  expect(response.headers.get('allow')).toBe('GET, HEAD')
})
