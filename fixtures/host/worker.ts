import {
  type AssetsBinding,
  createWorker,
  hitRateLimit,
  PgFromHyperdrive,
  serveAdmin,
  type WorkerContext,
} from '@opulonjs/core/workers'
import { workersCachePurge } from '@opulonjs/core/workers'
import { AttachmentResolver, Mailer } from '@opulonjs/emails/server'
import {
  type R2BucketLike,
  R2MediaStorage,
  r2MediaStorage,
  serveMedia,
} from '@opulonjs/media/server'
import { Effect, Layer, Schema } from 'effect'
import { privateNote, sizedBytes, sizedKey } from './modules/demo/server.ts'
import { server } from './server/opulon.ts'
import { staff } from './server/staff.ts'

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  readonly ASSETS: AssetsBinding
  /** R2 bucket holding media originals. */
  readonly MEDIA_BUCKET: R2BucketLike
  /** Commit SHA, set once in CI and passed to the admin build too (OPULON_BUILD_ID). */
  readonly OPULON_BUILD_ID: string
  /** The host's public origin (users: cookies, CSRF checks, emailed links). */
  readonly USERS_BASE_URL: string
  /** Signs session cookies (a secret: `wrangler secret put`). */
  readonly USERS_AUTH_SECRET: string
  readonly DEMO_RESEND_STUB?: string
  /** How long a password confirmation lasts (users; default 5 minutes). */
  readonly USERS_PASSWORD_CONFIRM_WINDOW?: string
}

const StubbedEmail = Schema.Struct({
  to: Schema.Array(Schema.String),
  attachments: Schema.optional(
    Schema.Array(Schema.Struct({ filename: Schema.String, content: Schema.String })),
  ),
})
const failedOnce = new Set<string>()

const resendStub: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const key = request.headers.get('idempotency-key') ?? ''
  const email = Schema.decodeUnknownSync(StubbedEmail)(await request.json())
  const failing = email.to.some((to) => to.startsWith('fail-once')) && !failedOnce.has(key)
  failedOnce.add(key)
  console.log(
    `resend stub ${failing ? '503' : '200'} ${JSON.stringify({
      to: email.to,
      attachments: (email.attachments ?? []).map((a) => ({
        filename: a.filename,
        base64Length: a.content.length,
      })),
    })}`,
  )
  return failing
    ? Response.json({ message: 'stub: the first attempt fails' }, { status: 503 })
    : Response.json({ id: `stub-${key}` })
}

const withCacheControl = (response: Response, value: string) => {
  const copy = new Response(response.body, response)
  copy.headers.set('cache-control', value)
  return copy
}

const serveSite = async (request: Request, assets: AssetsBinding) => {
  const url = new URL(request.url)
  if (url.pathname !== '/site' && !url.pathname.startsWith('/site/')) return undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
  if (url.pathname.startsWith('/site/assets/')) {
    const file = await assets.fetch(request)
    if (file.ok) return withCacheControl(file, 'public, max-age=31536000, immutable')
    return file.status === 404 ? withCacheControl(file, 'no-store') : file
  }
  const index = await assets.fetch(new Request(new URL('/site/index.html', url), request))
  return withCacheControl(index, 'no-store')
}

const serveContact = async (request: Request, env: Env) => {
  if (new URL(request.url).pathname !== '/contact' || request.method !== 'POST') return undefined
  const hit = await hitRateLimit(
    env.HYPERDRIVE,
    `contact:${request.headers.get('cf-connecting-ip')}`,
    3,
    '1 minute',
  )
  return hit.allowed
    ? new Response(null, { status: 204 })
    : new Response(null, { status: 429, headers: { 'retry-after': String(hit.retryAfter) } })
}

const privateJson = (body: unknown, setCookies: ReadonlyArray<string>) => {
  const response = Response.json(body, { headers: { 'cache-control': 'private, no-store' } })
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie)
  return response
}

const serveShop = async (request: Request, env: Env) => {
  const { pathname } = new URL(request.url)
  if (pathname === '/shop/staff') {
    const session = await staff.session(request, env)
    return privateJson({ user: session?.user ?? null }, session?.setCookies ?? [])
  }
  if (pathname === '/shop/orders') {
    const check = await staff.require(request, env, 'shop.orders.view')
    return check.ok
      ? privateJson({ viewer: check.user.id, orders: [] }, check.setCookies)
      : check.response
  }
  return undefined
}

/** The fixture Worker with a given Mailer; tests pass `captureMailer().layer`. */
export const hostWorker = (mailer?: Layer.Layer<Mailer>) => {
  const opulon = createWorker(server, {
    infra: (env: Env, ctx) =>
      Layer.mergeAll(
        PgFromHyperdrive(env.HYPERDRIVE),
        R2MediaStorage(env.MEDIA_BUCKET),
        mailer ??
          (env.DEMO_RESEND_STUB ? Layer.orDie(Mailer.resend({ fetch: resendStub })) : Mailer.log),
        Layer.succeed(
          AttachmentResolver,
          AttachmentResolver.of({
            resolve: (key) =>
              key === privateNote.key
                ? Effect.succeed(privateNote.content)
                : key.startsWith(sizedKey)
                  ? Effect.succeed(sizedBytes(Number(key.slice(sizedKey.length))))
                  : Effect.fail(new Error(`no attachment "${key}"`)),
          }),
        ),
        // Purges Read API (and in-process SSR) Cache-Tags on publish from this Worker's own
        // Workers Cache (`cache.enabled` in wrangler.jsonc).
        workersCachePurge(ctx),
      ),
    buildId: (env) => env.OPULON_BUILD_ID,
  })
  return {
    ...opulon,
    async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
      return (
        (await serveSite(request, env.ASSETS)) ??
        (await serveAdmin(request, env.ASSETS)) ??
        (await serveMedia(request, r2MediaStorage(env.MEDIA_BUCKET))) ??
        (await serveContact(request, env)) ??
        (await serveShop(request, env)) ??
        opulon.fetch(request, env, ctx)
      )
    },
  }
}

// The fixture logs emails instead of sending them; a real host uses Mailer.resend().
export default hostWorker()
