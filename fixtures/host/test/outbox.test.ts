import { expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeShop } from './support/shop.ts'

const db = useTestDatabase()
const shop = makeShop(() => db.url)
const fiveMinuteTick = '2026-10-13T10:05:00Z'
const midnight = '2026-10-14T00:00:00Z'

/** Time travel: makes every queued email due for its next attempt now. */
const makeDue = () =>
  adminQuery(db.url, "update emails.email_log set next_attempt_at = now() where status = 'queued'")

const entry = async (id: string) => (await shop.log()).rows.find((r) => r.id === id)

test('a committed send is delivered after commit, with the log id as idempotency key', async () => {
  const sent = shop.mailer.sent.length
  const { status, body } = await shop.order({ email: 'jana@example.test', name: 'Jana' })
  expect(status).toBe(200)
  expect(shop.mailer.sent.slice(sent)).toEqual([
    expect.objectContaining({
      from: 'Shop <noreply@example.test>',
      to: ['jana@example.test'],
      subject: 'Order A-7 confirmed',
      idempotencyKey: body.id,
      text: 'Thank you, Jana.',
      html: expect.stringContaining('<p>Thank you, Jana.</p>'),
    }),
  ])
  expect(await entry(body.id)).toMatchObject({
    templateKey: 'shop.order_confirmed',
    locale: 'en',
    recipients: ['jana@example.test'],
    subject: 'Order A-7 confirmed',
    status: 'sent',
    attempts: 1,
    error: null,
    about: { type: 'order', id: 'A-7' },
  })
})

test('placeholder values are HTML-escaped in the body', async () => {
  const sent = shop.mailer.sent.length
  await shop.order({ name: '<b>Eve</b>' })
  expect(shop.mailer.sent[sent]?.html).toContain('Thank you, &lt;b&gt;Eve&lt;/b&gt;.')
})

test('a rolled-back send never emails and leaves no log row', async () => {
  const before = await shop.log()
  const sent = shop.mailer.sent.length
  expect((await shop.order({ rollback: true })).body).toEqual({ id: 'rolled-back' })
  expect(shop.mailer.sent.length).toBe(sent)
  expect((await shop.log()).total).toBe(before.total)
})

test('the sweep retries a queued email with bounded attempts, then marks it failed', async () => {
  shop.mailer.failure = 'provider down'
  try {
    const { body } = await shop.order({ email: 'retry@example.test' })
    expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 1 })
    expect((await entry(body.id))?.error).toContain('provider down')

    // Not due yet: the backoff keeps the sweep from retrying right away.
    await shop.tick(fiveMinuteTick)
    expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 1 })

    await makeDue()
    await shop.tick(fiveMinuteTick)
    expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 2 })

    await makeDue()
    await shop.tick(fiveMinuteTick)
    expect(await entry(body.id)).toMatchObject({ status: 'failed', attempts: 3 })

    // Out of attempts: later sweeps leave it alone.
    await makeDue()
    shop.mailer.failure = undefined
    await shop.tick(fiveMinuteTick)
    expect(await entry(body.id)).toMatchObject({ status: 'failed', attempts: 3 })
    expect(shop.mailer.sent.some((m) => m.to.includes('retry@example.test'))).toBe(false)
  } finally {
    shop.mailer.failure = undefined
  }
})

test('the sweep delivers a queued email once the provider is back', async () => {
  shop.mailer.failure = 'provider down'
  const { body } = await shop.order({ email: 'later@example.test' })
  shop.mailer.failure = undefined
  await makeDue()
  await shop.tick(fiveMinuteTick)
  expect(await entry(body.id)).toMatchObject({ status: 'sent', attempts: 2, error: null })
  expect(shop.mailer.sent.filter((m) => m.idempotencyKey === body.id)).toHaveLength(1)
})

test('neither the body nor placeholder values are kept once an email is done', async () => {
  const rows = await adminQuery<{ message: unknown }>(
    db.url,
    "select message from emails.email_log where status <> 'queued'",
  )
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((r) => r.message === null)).toBe(true)
})

test('the daily purge removes log rows older than 90 days', async () => {
  const { body: old } = await shop.order({})
  const { body: recent } = await shop.order({})
  await adminQuery(
    db.url,
    `update emails.email_log set created_at = now() - interval '91 days' where id = '${old.id}'`,
  )
  await shop.tick(midnight)
  expect(await entry(old.id)).toBeUndefined()
  expect(await entry(recent.id)).toBeDefined()
})

test('the log filters by status and pages', async () => {
  const failed = await shop.log('?status=failed')
  expect(failed.rows.length).toBeGreaterThan(0)
  expect(failed.rows.every((r) => r.status === 'failed')).toBe(true)
  expect((await shop.log('?perPage=1&page=2')).rows).toHaveLength(1)
})
