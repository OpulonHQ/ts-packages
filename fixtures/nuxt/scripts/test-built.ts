// The built Nuxt Worker in workerd (TSPACK-38): drives `.output/server/index.mjs`'s own `fetch`
// through Miniflare, so the cloudflare-module preset's real dispatch is what gets checked, not a
// stand-in for it. Run with `pnpm --filter @opulonjs-fixtures/nuxt test:built` after `pnpm build`
// (the bootstrap CLI runs from packages/core/dist), with DATABASE_URL_TEST set as for `pnpm test`.
// A throwaway database is created, migrated and dropped; every check prints its evidence.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import pg from 'pg'

const nuxt = fileURLToPath(new URL('../', import.meta.url))
const host = fileURLToPath(new URL('../../host/', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/core/dist/cli.mjs', import.meta.url))
const origin = 'http://localhost'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`test:built failed: ${message}`)
}

const adminUrl = process.env.DATABASE_URL_TEST
check(adminUrl, 'DATABASE_URL_TEST is required')
const name = `tspack_built_${randomBytes(4).toString('hex')}`
const url = new URL(adminUrl)
url.pathname = `/${name}`
const databaseUrl = url.toString()

const admin = async (sql: string) => {
  const client = new pg.Client({ connectionString: adminUrl })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

const opulon = (args: Array<string>) =>
  execFileSync(process.execPath, [cli, ...args, '--server', 'server/opulon.ts'], {
    cwd: host,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL_DIRECT: databaseUrl, USERS_BASE_URL: origin },
  })

await admin(`create database ${name}`)
// Every module of the build, entry first: Nitro's chunks are loaded through dynamic imports
// Miniflare cannot trace.
const server = `${nuxt}.output/server/`
const chunks = readdirSync(server, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.mjs') && file !== 'index.mjs')
  .map((file) => ({ type: 'ESModule' as const, path: `${server}${file}` }))
const mf = new Miniflare({
  modulesRoot: server,
  modules: [{ type: 'ESModule', path: `${server}index.mjs` }, ...chunks],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  assets: {
    directory: `${nuxt}.output/public`,
    binding: 'ASSETS',
    routerConfig: { has_user_worker: true },
  },
  hyperdrives: { HYPERDRIVE: databaseUrl },
  bindings: {
    OPULON_BUILD_ID: 'test-built',
    USERS_BASE_URL: origin,
    USERS_AUTH_SECRET: randomBytes(32).toString('hex'),
  },
})
try {
  opulon(['migrate'])
  const email = `owner@example.test`
  const link = /accept-invitation#token=(\S+)/.exec(
    opulon(['users', 'invite-super-admin', '--email', email]),
  )
  check(link, 'no invitation link')

  let cookie = ''
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await mf.dispatchFetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })
    const text = await response.text()
    return { response, text }
  }

  const password = 'test built password'
  const accepted = await call('POST', '/api/users/invitations/accept', {
    token: decodeURIComponent(link[1]!),
    name: 'Owner',
    password,
  })
  check(
    accepted.response.status === 204,
    `accept ${accepted.response.status} ${accepted.text.slice(0, 300)}`,
  )
  const signedIn = await call('POST', '/api/users/auth/sign-in', { email, password })
  check(signedIn.response.status === 200, `sign-in ${signedIn.response.status}`)
  cookie = signedIn.response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')

  const path = '/built-page'
  const created = await call('POST', '/api/cms/pages', {
    locales: {
      en: {
        path,
        available: true,
        seo: { title: 'Built', description: '', image: null, noindex: true },
      },
    },
    sections: [{ id: crypto.randomUUID(), type: 'hero', data: { title: { en: 'Built page' } } }],
  })
  check(created.response.status === 200, `create ${created.response.status} ${created.text}`)
  const id = (JSON.parse(created.text) as { id: string }).id
  const published = await call('POST', `/api/cms/pages/${id}/publish`)
  check(published.response.status === 200, `publish ${published.response.status}`)

  // The personalized `send` route: no Cache-Control of its own, so the plugin's default.
  cookie = 'name=alice'
  const hello = await call('GET', '/hello')
  const helloPolicy = hello.response.headers.get('cache-control')
  check(hello.text === 'Hello alice', `/hello body ${hello.text}`)
  check(helloPolicy === 'private, no-store', `/hello Cache-Control ${helloPolicy}`)
  console.log(`ok  /hello (send, cookie): ${hello.text}, Cache-Control: ${helloPolicy}`)

  // The opted-in cms page: public under its tags.
  cookie = ''
  const page = await call('GET', path)
  const pagePolicy = page.response.headers.get('cache-control')
  const tags = page.response.headers.get('cache-tag')
  check(page.response.status === 200, `${path} ${page.response.status}`)
  check(pagePolicy?.startsWith('public'), `${path} Cache-Control ${pagePolicy}`)
  check(tags?.split(',').includes(`cms:page:${id}`), `${path} Cache-Tag ${tags}`)
  console.log(`ok  ${path} (opted in): Cache-Control: ${pagePolicy}, Cache-Tag: ${tags}`)
  console.log('test:built passed')
} finally {
  await mf.dispose()
  await admin(`drop database ${name} with (force)`)
}
