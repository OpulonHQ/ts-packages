import { createAdmin } from '@opulonjs/admin'
import { beforeAll, expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import worker, { type Env } from '../worker.ts'
import { makeShop } from './support/shop.ts'

// Runs in the `admin` vitest project: happy-dom, built by the opulonUi() preset.
const db = useTestDatabase()
const shop = makeShop(() => db.url)

beforeAll(async () => {
  await shop.order({ email: 'jana@example.test' })
  shop.mailer.failure = 'provider down'
  await shop.order({ email: 'later@example.test' })
  shop.mailer.failure = undefined
})

/** The admin's fetch, routed into the fixture host's Worker (no mocked API). */
const hostFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  request.headers.set('authorization', 'Bearer test-token')
  const env: Env = {
    HYPERDRIVE: { connectionString: db.url },
    DEMO_TOKEN: 'test-token',
    OPULON_BUILD_ID: 'b1',
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  }
  const pending: Array<Promise<unknown>> = []
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) })
  const body = await response.arrayBuffer()
  await Promise.all(pending)
  return new Response(body, response)
}

test('the email log screen lists emails with status and attempts, in the admin locale', async () => {
  history.replaceState(null, '', '/admin/emails/log')
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({ brand, modules: adminModules, buildId: 'b1', fetch: hostFetch })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  const text = () => document.body.textContent ?? ''

  await expect.poll(text).toContain('later@example.test')
  expect(document.querySelector('nav')?.textContent).toContain('Záznam e-mailov')
  expect(text()).toContain('Order A-7 confirmed')
  expect(text()).toContain('jana@example.test')
  expect(text()).toContain('Odoslaný')
  expect(text()).toContain('Vo fronte')
  const rows = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')
  expect(rows.find((r) => r.includes('later@example.test'))).toMatch(/Vo fronte\s*1$/)
})
