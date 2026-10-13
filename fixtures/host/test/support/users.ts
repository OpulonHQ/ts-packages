// The fixture host with captured emails, plus staff users signed in for real (through users'
// sign-in endpoint). Shared by every test that needs a signed-in user.
import { randomBytes, randomUUID } from 'node:crypto'
import { Me } from '@opulonjs/core/api'
import { captureMailer } from '@opulonjs/emails/server'
import { hashPassword } from '@opulonjs/users/server'
import { Schema } from 'effect'
import pg from 'pg'
import { type Env, hostWorker } from '../../worker.ts'
import { memoryBucket } from '../memory-bucket.ts'

export const origin = 'https://host.test'

/** users' Config for a test Worker env. */
export const usersEnv = {
  USERS_BASE_URL: origin,
  USERS_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
} as const

export interface HostResponse {
  readonly status: number
  readonly headers: Headers
  readonly body: unknown
}

/** The fixture Worker over `databaseUrl()`, with a capture mailer and a request helper. */
export function makeHost(databaseUrl: () => string, options: { buildId?: string } = {}) {
  const mailer = captureMailer()
  const worker = hostWorker(mailer.layer)
  const bucket = memoryBucket()
  const env = (): Env => ({
    HYPERDRIVE: { connectionString: databaseUrl() },
    OPULON_BUILD_ID: options.buildId ?? 'build-1',
    ...usersEnv,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    MEDIA_BUCKET: bucket,
  })

  /** One request through the Worker; resolves after every waitUntil promise settled. */
  async function fetch(request: Request): Promise<Response> {
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(request, env(), { waitUntil: (p) => pending.push(p) })
    const body = await response.arrayBuffer()
    await Promise.all(pending)
    return new Response(body.byteLength ? body : null, response)
  }

  /**
   * A same-origin JSON request. `ip` is the client address (rate limits are per address);
   * by default every call gets its own, so tests never trip each other's limits.
   */
  async function request(
    method: string,
    path: string,
    o: { body?: unknown; cookie?: string; ip?: string; headers?: Record<string, string> } = {},
  ): Promise<HostResponse> {
    const headers = new Headers({
      origin,
      'cf-connecting-ip': o.ip ?? randomIp(),
      'user-agent': 'vitest',
      ...o.headers,
    })
    if (o.cookie) headers.set('cookie', o.cookie)
    if (o.body !== undefined) headers.set('content-type', 'application/json')
    const response = await fetch(
      new Request(`${origin}/api${path}`, {
        method,
        headers,
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      }),
    )
    const text = await response.text()
    const json = response.headers.get('content-type')?.includes('json')
    return {
      status: response.status,
      headers: response.headers,
      body: json ? JSON.parse(text) : text,
    }
  }

  /** Signs in through the real endpoint; resolves with the Cookie header for later requests. */
  async function signIn(email: string, password: string, ip?: string): Promise<string> {
    const response = await request('POST', '/users/auth/sign-in', {
      body: { email, password },
      ...(ip ? { ip } : {}),
    })
    if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`)
    return cookieHeader(response.headers)
  }

  /**
   * A fetch for the admin app (happy-dom) routed into the Worker, acting as a same-origin
   * browser: it sends the jar's cookie and keeps the jar up to date from Set-Cookie.
   */
  const browserFetch =
    (jar: { cookie: string }): typeof globalThis.fetch =>
    async (input, init) => {
      const request = new Request(input, init)
      request.headers.set('origin', origin)
      if (jar.cookie) request.headers.set('cookie', jar.cookie)
      const response = await fetch(request)
      if (response.headers.getSetCookie().length > 0) jar.cookie = cookieHeader(response.headers)
      return response
    }

  /** `/me` of a signed-in session, decoded. */
  const me = async (cookie: string) =>
    Schema.decodeUnknownSync(Me)((await request('GET', '/me', { cookie })).body)

  return { worker, mailer, env, fetch, request, signIn, browserFetch, me }
}

/**
 * Session cookies of seeded users holding given permissions, signed in for real through
 * `send` (a test Worker's fetch). One user per permission set, cached.
 */
export const sessions = (
  databaseUrl: () => string,
  send: (request: Request) => Promise<Response>,
) => {
  const cache = new Map<string, Promise<string>>()
  return (permissions: ReadonlyArray<string>, o: { name?: string; locale?: string } = {}) => {
    const key = JSON.stringify([permissions, o])
    let cookie = cache.get(key)
    if (!cookie) {
      cookie = (async () => {
        const user = await seedUser(databaseUrl(), { permissions, ...o })
        const response = await send(
          new Request(`${origin}/api/users/auth/sign-in`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': randomIp() },
            body: JSON.stringify({ email: user.email, password: user.password }),
          }),
        )
        if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`)
        return cookieHeader(response.headers)
      })()
      cache.set(key, cookie)
    }
    return cookie
  }
}

/** The Cookie header a browser would send back after `headers`' Set-Cookie. */
export const cookieHeader = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')

export const randomIp = () => `10.${[...randomBytes(3)].join('.')}`

export interface SeededUser {
  readonly id: string
  readonly email: string
  readonly password: string
}

/**
 * Creates an active staff user directly in the database: a role granting `permissions` (or the
 * built-in Super admin), the Better Auth user and its credential. Direct writes on purpose: the
 * roles API needs a signed-in Super admin first, and tests of the guard use the API itself.
 */
export async function seedUser(
  databaseUrl: string,
  o: {
    email?: string
    name?: string
    password?: string
    permissions?: ReadonlyArray<string>
    superAdmin?: boolean
    locale?: string | null
  } = {},
): Promise<SeededUser> {
  const id = randomUUID()
  const email = o.email ?? `user-${id.slice(0, 8)}@example.test`
  const password = o.password ?? 'correct horse battery'
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into users."user" (id, name, email, email_verified, admin_locale)
       values ($1, $2, $3, true, $4)`,
      [id, o.name ?? 'Test User', email, o.locale ?? null],
    )
    await client.query(
      `insert into users.account (id, account_id, provider_id, user_id, password, updated_at)
       values ($1, $2, 'credential', $2, $3, now())`,
      [randomUUID(), id, await hashPassword(password)],
    )
    let roleId = 'super_admin'
    if (!o.superAdmin) {
      roleId = randomUUID()
      await client.query('insert into users.role (id, name, permissions) values ($1, $1, $2)', [
        roleId,
        o.permissions ?? [],
      ])
    }
    await client.query('insert into users.user_role (user_id, role_id) values ($1, $2)', [
      id,
      roleId,
    ])
    await client.query('commit')
  } finally {
    await client.end()
  }
  return { id, email, password }
}

/** A role with the given permissions, written directly (see seedUser); resolves with its id. */
export async function seedRole(databaseUrl: string, permissions: ReadonlyArray<string>) {
  const id = randomUUID()
  await sqlQuery(
    databaseUrl,
    'insert into users.role (id, name, permissions) values ($1, $1, $2)',
    [id, permissions],
  )
  return id
}

export async function sqlQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(
  databaseUrl: string,
  text: string,
  values: ReadonlyArray<unknown> = [],
): Promise<Array<R>> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return (await client.query<R>(text, [...values])).rows
  } finally {
    await client.end()
  }
}

/** The token in an emailed admin link (`.../admin/<route>#token=...`). */
export const tokenFrom = (html: string) => {
  const match = /#token=([^"&<\s]+)/.exec(html)
  if (!match) throw new Error('no token link in the email')
  return decodeURIComponent(match[1]!)
}
