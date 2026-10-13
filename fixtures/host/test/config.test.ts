import { composeServer, defineModule, Public } from '@opulonjs/core'
import { createWorker, PgFromHyperdrive } from '@opulonjs/core/workers'
import { Config, Effect, Redacted, Schema } from 'effect'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import { afterEach, expect, test, vi } from 'vitest'

// Module config: Effect Config over the Worker env, keys prefixed with the module id.
const settings = Config.all({
  greeting: Config.String('CFG_GREETING').pipe(Config.withDefault('missing')),
  apiKey: Config.Redacted('CFG_API_KEY'),
  // A binding is not config: it reaches modules only through the host's infra(env).
  binding: Config.String('HYPERDRIVE').pipe(Config.withDefault('missing')),
})

const CfgGroup = HttpApiGroup.make('cfg')
  .add(
    HttpApiEndpoint.get('show', '/show', {
      success: Schema.Struct({
        greeting: Schema.String,
        apiKey: Schema.String,
        apiKeyLength: Schema.Number,
        binding: Schema.String,
      }),
    }),
  )
  .annotate(Public, true)

const cfg = defineModule({
  id: 'cfg',
  groups: [CfgGroup],
  handlers: (api) =>
    HttpApiBuilder.group(api, 'cfg', (h) =>
      Effect.succeed(
        h.handle('show', () =>
          Effect.map(Effect.orDie(settings), (s) => ({
            greeting: s.greeting,
            apiKey: String(s.apiKey),
            apiKeyLength: Redacted.value(s.apiKey).length,
            binding: s.binding,
          })),
        ),
      ),
    ),
})

interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  readonly CFG_GREETING?: string
  readonly CFG_API_KEY: string
}

const worker = createWorker(composeServer({ modules: [cfg] }), {
  infra: (env: Env) => PgFromHyperdrive(env.HYPERDRIVE),
  buildId: () => 'test',
})

const show = async (env: Env) => {
  const response = await worker.fetch(new Request('https://host.test/api/cfg/show'), env, {
    waitUntil: () => {},
  })
  return response.json()
}

const hyperdrive = { connectionString: 'postgres://unused@127.0.0.1:1/none' }

afterEach(() => {
  delete process.env.CFG_GREETING
})

test('modules read vars and secrets from the env through Effect Config; secrets stay redacted', async () => {
  expect(
    await show({ HYPERDRIVE: hyperdrive, CFG_GREETING: 'ahoj', CFG_API_KEY: 'k-123' }),
  ).toEqual({ greeting: 'ahoj', apiKey: '<redacted>', apiKeyLength: 5, binding: 'missing' })
})

test('config comes from the Worker env only, never from process.env', async () => {
  process.env.CFG_GREETING = 'from process.env'
  expect(await show({ HYPERDRIVE: hyperdrive, CFG_API_KEY: 'k' })).toMatchObject({
    greeting: 'missing',
  })
})

test('a request that dies answers 500 and logs its cause, without the message', async () => {
  const logged: Array<string> = []
  const capture = (...args: Array<unknown>) =>
    void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  const spies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(capture),
  )
  try {
    // A deploy missing the CFG_API_KEY secret: the handler's Effect.orDie(settings) dies.
    const response = await worker.fetch(
      new Request('https://host.test/api/cfg/show'),
      { HYPERDRIVE: hyperdrive } as Env,
      { waitUntil: () => {} },
    )
    expect(response.status).toBe(500)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  const log = logged.join('\n')
  expect(log).toContain('request failed')
  expect(log).toContain('ConfigError')
  // Messages can carry user data; this one names the missing key.
  expect(log).not.toContain('CFG_API_KEY')
})
