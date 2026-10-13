import { createAdmin } from '@opulonjs/admin'
import { beforeAll, expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeShop } from './support/shop.ts'
import { makeHost, seedUser } from './support/users.ts'

// Runs in the `admin` vitest project: happy-dom, built by the opulonUi() preset.
const db = useTestDatabase()
const shop = makeShop(() => db.url)

beforeAll(async () => {
  await shop.order({ email: 'jana@example.test' })
  shop.mailer.failure = 'provider down'
  await shop.order({ email: 'later@example.test' })
  shop.mailer.failure = undefined
})

let hostFetch: typeof fetch
beforeAll(async () => {
  const host = makeHost(() => db.url, { buildId: 'b1' })
  const user = await seedUser(db.url, { locale: 'sk', permissions: ['emails.log.view'] })
  hostFetch = host.browserFetch({ cookie: await host.signIn(user.email, user.password) })
})

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
