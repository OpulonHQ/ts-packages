import type { MediaItem } from '@opulonjs/media/api'
import { useTestDatabase } from '../../../../test/postgres/index.ts'
import worker, { type Env } from '../../worker.ts'
import { memoryBucket } from '../memory-bucket.ts'

const text = (value: string) => new TextEncoder().encode(value)
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number) => [(n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const box = (type: string, body: ArrayLike<number>) =>
  Uint8Array.from([...be32(8 + body.length), ...text(type), ...Array.from(body)])

/** Minimal files: just the headers type sniffing and dimension reading look at. */
export const files = {
  png: (w: number, h: number) =>
    Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      ...text('IHDR'),
      ...be32(w),
      ...be32(h),
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]),
  jpeg: (w: number, h: number) =>
    Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      16,
      ...text('JFIF'),
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      0xff,
      0xc0,
      0,
      17,
      8,
      ...be16(h),
      ...be16(w),
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
      0xff,
      0xd9,
    ]),
  gif: (w: number, h: number) =>
    Uint8Array.from([...text('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0]),
  webp: (w: number, h: number) =>
    Uint8Array.from([
      ...text('RIFF'),
      22,
      0,
      0,
      0,
      ...text('WEBPVP8X'),
      10,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...le24(w - 1),
      ...le24(h - 1),
    ]),
  avif: (w: number, h: number) =>
    Uint8Array.from([
      ...box('ftyp', [...text('avif'), 0, 0, 0, 0, ...text('mif1')]),
      ...box('meta', [
        0,
        0,
        0,
        0,
        ...box('iprp', box('ipco', box('ispe', [0, 0, 0, 0, ...be32(w), ...be32(h)]))),
      ]),
    ]),
  pdf: () => text('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n'),
  svg: () => text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  mp4: () => box('ftyp', [...text('isom'), 0, 0, 2, 0, ...text('isomiso2mp41')]),
  html: () => text('<!doctype html><script>alert(1)</script>'),
}

/**
 * Encodes a FormData body up front, as a browser does. Node's lazily streamed FormData body
 * errors when the server stops reading early (an oversized upload).
 */
export const multipart = async (data: FormData, headers: Headers) => {
  const encoded = new Response(data)
  headers.set('content-type', encoded.headers.get('content-type')!)
  return encoded.arrayBuffer()
}

/** The fixture host's Worker over a fresh database and an in-memory media bucket. */
export const useHost = () => {
  const db = useTestDatabase()
  const bucket = memoryBucket()
  const env = (): Env => ({
    HYPERDRIVE: { connectionString: db.url },
    DEMO_TOKEN: 'test-token',
    OPULON_BUILD_ID: 'build-1',
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    MEDIA_BUCKET: bucket,
  })

  /** Calls the Worker. `as` narrows the demo user's permissions; null sends no token. */
  const call = async <Body = unknown>(
    method: string,
    path: string,
    { body, as }: { body?: BodyInit; as?: ReadonlyArray<string> | null } = {},
  ) => {
    const headers = new Headers()
    if (as !== null)
      headers.set('authorization', `Bearer test-token${as ? `:${as.join(',')}` : ''}`)
    if (typeof body === 'string') headers.set('content-type', 'application/json')
    if (body instanceof FormData) body = await multipart(body, headers)
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(
      new Request(`https://host.test${path}`, { method, headers, body: body ?? null }),
      env(),
      { waitUntil: (p) => pending.push(p) },
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    await Promise.all(pending)
    const json = response.headers.get('content-type')?.includes('json')
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      // Typed by the caller (the API's success schema); error bodies are only matched.
      body: (json ? JSON.parse(new TextDecoder().decode(bytes)) : undefined) as Body,
    }
  }

  const form = (bytes: Uint8Array, name: string, type: string) => {
    const data = new FormData()
    data.append('file', new Blob([bytes.slice()], { type }), name)
    return data
  }

  return {
    db,
    bucket,
    call,
    upload: (bytes: Uint8Array, name: string, type: string, as?: ReadonlyArray<string>) =>
      call<MediaItem>('POST', '/api/media/items', {
        body: form(bytes, name, type),
        ...(as ? { as } : {}),
      }),
    replace: (id: string, bytes: Uint8Array, name: string, type: string) =>
      call<MediaItem>('PUT', `/api/media/items/${id}/file`, { body: form(bytes, name, type) }),
  }
}
