import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeShop } from './support/shop.ts'

const db = useTestDatabase()
const shop = makeShop(() => db.url)

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)
const entry = async (id: string) => (await shop.log()).rows.find((r) => r.id === id)

test('a send carries its attachments, copies and reply-to to the mailer', async () => {
  const sent = shop.mailer.sent.length
  const { status, body } = await shop.document({
    to: 'jana@example.test',
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    files: [{ filename: 'invite.ics', contentType: 'text/calendar', text: 'BEGIN:VCALENDAR' }],
  })
  expect(status).toBe(200)
  const [message] = shop.mailer.sent.slice(sent)
  expect(message).toMatchObject({
    to: ['jana@example.test'],
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    idempotencyKey: body.id,
    attachments: [{ filename: 'invite.ics', contentType: 'text/calendar' }],
  })
  expect(text(message?.attachments?.[0]?.content)).toBe('BEGIN:VCALENDAR')
})
