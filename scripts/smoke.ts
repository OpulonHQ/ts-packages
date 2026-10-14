// Deploy smoke for the fixture host: drives a deployed Worker end to end (TSPACK-37).
//
//   SMOKE_URL=https://<worker>.workers.dev DATABASE_URL_DIRECT=postgres://... pnpm smoke
//
// Needs a migrated database and a built repo (the bootstrap CLI runs from packages/core/dist).
// DATABASE_URL_DIRECT is the database's direct (not Hyperdrive) URL: the bootstrap CLI writes
// the first invitation through it, and the outbox check queues one email there for the next
// */5 cron tick to sweep. Every step prints its evidence; the first failure exits non-zero.
// Nothing here is account-specific; ids and URLs come from the environment.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const host = fileURLToPath(new URL('../fixtures/host/', import.meta.url))
const cli = fileURLToPath(new URL('../packages/core/dist/cli.mjs', import.meta.url))

const base = required('SMOKE_URL').replace(/\/$/, '')
const databaseUrl = required('DATABASE_URL_DIRECT')
/** How long to wait for the cron tick that sweeps the queued email (the trigger runs every 5 minutes). */
const cronWaitMs = Number(process.env.SMOKE_CRON_WAIT_MS ?? 7 * 60_000)

const run = randomBytes(4).toString('hex')
const email = `owner-${run}@example.test`
const password = `smoke password ${run}`
let cookie = ''

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke failed: ${message}`)
}

async function api(method: string, path: string, body?: unknown | FormData) {
  const headers = new Headers({ origin: base })
  if (cookie) headers.set('cookie', cookie)
  if (body !== undefined && !(body instanceof FormData))
    headers.set('content-type', 'application/json')
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  })
  const text = await response.text()
  const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text
  return { status: response.status, headers: response.headers, body: json }
}

async function step(name: string, fn: () => Promise<string>) {
  const started = Date.now()
  const evidence = await fn()
  console.log(`ok  ${name} (${Date.now() - started} ms): ${evidence}`)
}

/** A PNG header (signature + IHDR) is all media reads for type and dimensions. */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr.set([8, 6, 0, 0, 0], 16)
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]),
  )
}

async function sql<Row>(text: string, values: ReadonlyArray<unknown> = []): Promise<Array<Row>> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return (await client.query(text, [...values])).rows as Array<Row>
  } finally {
    await client.end()
  }
}

let token = ''
await step('bootstrap invite (opulon users invite-super-admin)', async () => {
  let stdout: string
  try {
    stdout = execFileSync(
      process.execPath,
      [cli, 'users', 'invite-super-admin', '--server', 'server/opulon.ts', '--email', email],
      {
        cwd: host,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL_DIRECT: databaseUrl, USERS_BASE_URL: base },
      },
    )
  } catch (error) {
    // A host smoked before (the permanent test host) already has its Super admin, and the CLI
    // only bootstraps the first one: invite this run's owner the way the CLI would.
    if (!String((error as { stderr?: unknown }).stderr).includes('a Super admin already exists'))
      throw error
    token = randomBytes(32).toString('base64url')
    await sql(
      `insert into users.invitation (id, email, role_ids, token_hash, expires_at)
       values ($1, $2, '{super_admin}', $3, now() + interval '1 hour')`,
      [randomUUID(), email, createHash('sha256').update(token).digest('hex')],
    )
    return 'already bootstrapped: Super admin invitation inserted directly'
  }
  const link = /\/admin\/accept-invitation#token=(\S+)/.exec(stdout)
  check(link, `no invitation link in CLI output: ${stdout}`)
  token = decodeURIComponent(link[1]!)
  return 'link printed'
})

await step('accept the invitation', async () => {
  const inspect = await api('POST', '/api/users/invitations/inspect', { token })
  check(inspect.status === 200, `inspect ${inspect.status}`)
  const accepted = await api('POST', '/api/users/invitations/accept', {
    token,
    name: 'Smoke Owner',
    password,
  })
  check(accepted.status === 204, `accept ${accepted.status} ${JSON.stringify(accepted.body)}`)
  return `inspect 200 (${inspect.body.email}), accept 204`
})

await step('sign in', async () => {
  const response = await api('POST', '/api/users/auth/sign-in', { email, password })
  check(response.status === 200, `sign-in ${response.status}`)
  cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')
  const me = await api('GET', '/api/me')
  check(me.status === 200, `/me ${me.status}`)
  check(
    me.body.permissions.length === me.body.permissionCatalog.length,
    'the Super admin lacks permissions',
  )
  return `sign-in 200, /me 200 with all ${me.body.permissions.length} permissions`
})

let mediaId = ''
await step('upload media', async () => {
  const form = new FormData()
  form.append('file', new File([png(800, 600)], `smoke-${run}.png`, { type: 'image/png' }))
  const uploaded = await api('POST', '/api/media/items', form)
  check(uploaded.status === 200, `upload ${uploaded.status} ${JSON.stringify(uploaded.body)}`)
  mediaId = uploaded.body.id
  const original = await fetch(`${base}${uploaded.body.url}`)
  check(original.status === 200, `GET ${uploaded.body.url} ${original.status}`)
  return `upload 200, GET original 200 (${original.headers.get('content-type')}, ${original.headers.get('cache-control')})`
})

const path = `/smoke-${run}`
let pageId = ''
await step('create and publish a page', async () => {
  const created = await api('POST', '/api/cms/pages', {
    locales: {
      en: {
        path,
        available: true,
        seo: { title: 'Smoke', description: '', image: mediaId, noindex: true },
      },
    },
    sections: [
      {
        id: crypto.randomUUID(),
        type: 'hero',
        data: { title: { en: 'Smoke test' }, image: mediaId },
      },
    ],
  })
  check(created.status === 200, `create ${created.status} ${JSON.stringify(created.body)}`)
  pageId = created.body.id
  const published = await api(
    'POST',
    `/api/cms/pages/${pageId}/publish?version=${created.body.version}`,
  )
  check(published.status === 200, `publish ${published.status}`)
  return 'create 200, publish 200'
})

await step('Read API resolve with Cache-Tag', async () => {
  const saved = cookie
  cookie = '' // anonymous, as a public site reads
  const resolved = await api('GET', `/api/cms/resolve?path=${encodeURIComponent(path)}`)
  cookie = saved
  check(resolved.status === 200, `resolve ${resolved.status}`)
  check(resolved.body.kind === 'page' && resolved.body.id === pageId, 'resolved another page')
  check(resolved.body.sections[0]?.data.image?.id === mediaId, 'hero image not resolved')
  const tags = resolved.headers.get('cache-tag')
  check(tags?.split(',').includes(`cms:page:${pageId}`), `Cache-Tag ${tags}`)
  return `200, Cache-Tag: ${tags}, Cache-Control: ${resolved.headers.get('cache-control')}`
})

const logRow = async (id: string) => {
  const log = await api('GET', '/api/emails/log?perPage=100')
  check(log.status === 200, `email log ${log.status}`)
  return log.body.rows.find((r: { id: string }) => r.id === id) as
    { status: string; attempts: number } | undefined
}

await step('an invitation email is delivered after commit', async () => {
  const invited = await api('POST', '/api/users/invitations', {
    email: `invitee-${run}@example.test`,
    roleIds: [],
  })
  check(invited.status === 200, `invite ${invited.status} ${JSON.stringify(invited.body)}`)
  const [row] = await sql<{ id: string }>(`select id from emails.email_log where recipients ? $1`, [
    `invitee-${run}@example.test`,
  ])
  check(row, 'no email log row for the invitation')
  const entry = await logRow(row.id)
  check(entry?.status === 'sent', `invitation email ${entry?.status}`)
  return `invite 200, email log row ${entry.status} after ${entry.attempts} attempt(s)`
})

await step('the cron tick sweeps a queued email', async () => {
  // Stands in for an email whose first delivery failed: queued, due now, one attempt left.
  const [row] = await sql<{ id: string }>(
    `insert into emails.email_log (template_key, locale, recipients, subject, status, message)
     values ('users.invitation', 'en', $1::jsonb, 'Smoke sweep', 'queued', $2::jsonb)
     returning id`,
    [
      JSON.stringify([`sweep-${run}@example.test`]),
      JSON.stringify({
        from: 'Smoke <noreply@example.test>',
        to: [`sweep-${run}@example.test`],
        subject: 'Smoke sweep',
        html: '<p>Swept</p>',
        text: 'Swept',
      }),
    ],
  )
  const queuedAt = Date.now()
  for (;;) {
    const entry = await logRow(row!.id)
    if (entry?.status === 'sent')
      return `queued row sent by the scheduled sweep after ${Math.round((Date.now() - queuedAt) / 1000)} s`
    check(entry?.status === 'queued', `swept email ${entry?.status}`)
    check(Date.now() - queuedAt < cronWaitMs, 'no cron tick swept the queued email in time')
    await new Promise((r) => setTimeout(r, 15_000))
  }
})

console.log('smoke passed')
