import { beforeAll, expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeShop } from './support/shop.ts'
import { makeHost, seedUser } from './support/users.ts'

// Runs in the `admin` vitest project: happy-dom, built by the opulonUi() preset.
const admin = useAdminLifetime()
const db = useTestDatabase()
const shop = makeShop(() => db.url)

beforeAll(async () => {
  await shop.order({ email: 'jana@example.test' })
  shop.mailer.failure = 'provider down'
  await shop.order({ email: 'later@example.test' })
  shop.mailer.failure = undefined
  await shop.document({
    to: 'notary@example.test',
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    files: [
      { filename: 'invite.ics', contentType: 'text/calendar', text: 'BEGIN:VCALENDAR' },
      { filename: 'deed.pdf', contentType: 'application/pdf', key: 'deeds/7', size: 2_621_440 },
    ],
  })
})

let hostFetch: typeof fetch
beforeAll(async () => {
  const host = admin.track(makeHost(() => db.url, { buildId: 'b1' }))
  const user = await seedUser(db.url, { locale: 'sk', permissions: ['emails.log.view'] })
  hostFetch = host.browserFetch({ cookie: await host.signIn(user.email, user.password) })
})

test('the email log screen lists emails with status and attempts, in the admin locale', async () => {
  const text = admin.mount('/admin/emails/log', { fetch: hostFetch, buildId: 'b1' })

  await expect.poll(text).toContain('later@example.test')
  expect(document.querySelector('nav')?.textContent).toContain('Záznam e-mailov')
  expect(text()).toContain('Order A-7 confirmed')
  expect(text()).toContain('jana@example.test')
  expect(text()).toContain('Odoslaný')
  expect(text()).toContain('Vo fronte')
  const rows = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')
  expect(rows.find((r) => r.includes('later@example.test'))).toMatch(/Vo fronte\s*1$/)
})

test('the email log screen shows copies, reply-to and each attachment with its size', async () => {
  const text = admin.mount('/admin/emails/log', { fetch: hostFetch, buildId: 'b1' })

  await expect.poll(text).toContain('notary@example.test')
  const row = [...document.querySelectorAll('tbody tr')]
    .map((r) => r.textContent ?? '')
    .find((r) => r.includes('notary@example.test'))
  expect(row).toContain('Kópia: copy@example.test')
  expect(row).toContain('Skrytá kópia: hidden@example.test')
  expect(row).toContain('Odpovedať na: sender@example.test')
  expect(row).toMatch(/invite\.ics \(15\sB\)/)
  expect(row).toMatch(/deed\.pdf \(2,5\sMB\)/)
})
