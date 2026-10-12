import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeShop } from './support/shop.ts'

const db = useTestDatabase()
const shop = makeShop(() => db.url)

/** The email the next request sends. */
const next = async (send: () => Promise<unknown>) => {
  const before = shop.mailer.sent.length
  await send()
  expect(shop.mailer.sent.length).toBe(before + 1)
  return shop.mailer.sent[before]!
}

const alert = (locale: string | null) => () =>
  shop.request('POST', '/shop/alerts', undefined, locale)

test('staff emails render in the recipient admin locale', async () => {
  const email = await next(alert('sk'))
  expect(email).toMatchObject({ to: ['eva@example.test'], subject: 'Ahoj Eva' })
  expect(email.html).toContain('<html lang="sk">')
  expect(email.html).toContain('Pätička obchodu')
})

test('staff without an admin locale, or with one the template lacks, get the default', async () => {
  expect((await next(alert(null))).subject).toBe('Hello Eva')
  expect((await next(alert('de'))).subject).toBe('Hello Eva')
})

test('public emails render in the requested content locale', async () => {
  expect((await next(() => shop.order({ locale: 'it' }))).subject).toBe('Ordine A-7 confermato')
})

test('public emails fall back to the default content locale for other locales', async () => {
  // sk is an admin locale, not a content locale of this host.
  expect((await next(() => shop.order({ locale: 'sk' }))).subject).toBe('Order A-7 confirmed')
  expect((await shop.log()).rows[0]).toMatchObject({ locale: 'en' })
})
