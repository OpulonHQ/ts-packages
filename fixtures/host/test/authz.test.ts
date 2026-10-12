import * as PgClient from '@effect/sql-pg/PgClient'
import {
  authorization,
  Authorization,
  composeServer,
  defineModule,
  migrate,
  Policy,
  Public,
  requirePermission,
} from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Effect, Layer, Redacted, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import { Forbidden } from 'effect/http-api/HttpApiError'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { SqlClient } from 'effect/sql/SqlClient'
import { beforeAll, expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'

// A privileged service: it checks `vault.secrets.read` itself, whoever calls it.
const readSecret = requirePermission('vault.secrets.read').pipe(Effect.as('s3cret'))

const VaultGroup = HttpApiGroup.make('vault')
  .add(
    HttpApiEndpoint.get('secret', '/secret', { success: Schema.String }).annotate(
      Policy,
      'signedIn',
    ),
  )
  .middleware(Authorization)

// A public group whose handler (wrongly) calls the privileged service.
const LeakGroup = HttpApiGroup.make('vault.public')
  .add(
    HttpApiEndpoint.get('secret', '/public/secret', { success: Schema.String, error: Forbidden }),
  )
  .annotate(Public, true)

const vault = defineModule({
  id: 'vault',
  groups: [VaultGroup, LeakGroup],
  handlers: (api) =>
    Layer.mergeAll(
      HttpApiBuilder.group(api, 'vault', (h) => Effect.succeed(h.handle('secret', () => readSecret))),
      HttpApiBuilder.group(api, 'vault.public', (h) =>
        Effect.succeed(h.handle('secret', () => readSecret)),
      ),
    ),
  migrations: {
    '0001_create': Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`create table vault.read (secret text not null)`
    }),
  },
  permissions: ['vault.secrets.read'],
  tasks: [
    {
      name: 'read',
      every: '5m',
      run: Effect.gen(function* () {
        const sql = yield* SqlClient
        const secret = yield* readSecret
        yield* sql`insert into vault.read (secret) values (${secret})`
      }),
    },
  ],
})

const users: Record<string, ReadonlyArray<string>> = {
  reader: ['vault.secrets.read'],
  nobody: [],
}

const server = composeServer({ modules: [vault] })
const worker = createWorker(server, {
  infra: (env: { readonly url: string }) =>
    Layer.mergeAll(
      PgFromHyperdrive({ connectionString: env.url }),
      authorization((request) => {
        const token = request.headers.authorization?.replace('Bearer ', '') ?? ''
        const permissions = users[token]
        return Effect.succeed(
          permissions
            ? { id: token, name: token, email: `${token}@example.test`, locale: null, permissions }
            : undefined,
        )
      }),
    ),
  buildId: () => 'test',
})
const db = useTestDatabase()

beforeAll(async () => {
  await Effect.runPromise(
    migrate(server.modules).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 2 })),
    ),
  )
})

async function get(path: string, token?: string) {
  const response = await worker.fetch(
    new Request(`https://host.test/api/vault${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { url: db.url },
    { waitUntil: () => {} },
  )
  return { status: response.status, body: await response.text() }
}

test('a signed-in user holding the permission passes the service check', async () => {
  expect(await get('/secret', 'reader')).toEqual({ status: 200, body: '"s3cret"' })
})

test('a signed-in user without the permission is refused by the service itself', async () => {
  expect((await get('/secret', 'nobody')).status).toBe(403)
})

test('a privileged service called from a public handler is refused', async () => {
  expect((await get('/public/secret')).status).toBe(403)
  expect((await get('/public/secret', 'reader')).status).toBe(403)
})

test('tasks run as the system actor, which bypasses permission checks explicitly', async () => {
  await worker.scheduled(
    { scheduledTime: Date.parse('2026-10-13T10:05:00Z'), cron: '*/5 * * * *' },
    { url: db.url },
  )
  const rows = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient
      return yield* sql<{ secret: string }>`select secret from vault.read`
    }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(db.url), maxConnections: 1 }))),
  )
  expect(rows).toEqual([{ secret: 's3cret' }])
})
