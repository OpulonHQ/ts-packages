import { maxAttachmentsBytes } from '@opulonjs/emails/api'
import { expect, test } from 'vitest'
import { adminQuery } from '../../../test/postgres/admin.ts'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeShop } from './support/shop.ts'

const db = useTestDatabase()
const shop = makeShop(() => db.url)
const fiveMinuteTick = '2026-10-13T10:05:00Z'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (content: Uint8Array | undefined) => new TextDecoder().decode(content)
const entry = async (id: string) => (await shop.log()).rows.find((r) => r.id === id)
const sentAs = (id: string) => shop.mailer.sent.filter((m) => m.idempotencyKey === id)
const makeDue = () =>
  adminQuery(db.url, "update emails.email_log set next_attempt_at = now() where status = 'queued'")
const stored = async (id: string) =>
  (
    await adminQuery<{ message: string | null }>(
      db.url,
      `select message::text as message from emails.email_log where id = '${id}'`,
    )
  )[0]?.message

const ics = { filename: 'invite.ics', contentType: 'text/calendar; method=REQUEST' }
const deed = { filename: 'deed.pdf', contentType: 'application/pdf', key: 'deeds/7' }

test('a send carries its attachments, copies and reply-to to the mailer', async () => {
  const { status, body } = await shop.document({
    to: 'jana@example.test',
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    files: [{ ...ics, text: 'BEGIN:VCALENDAR' }],
  })
  expect(status).toBe(200)
  const [message] = sentAs(body.id)
  expect(message).toMatchObject({
    to: ['jana@example.test'],
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    attachments: [ics],
  })
  expect(text(message?.attachments?.[0]?.content)).toBe('BEGIN:VCALENDAR')
})

test("reply-to falls back to the module's configured address", async () => {
  const { body } = await shop.document({})
  expect(sentAs(body.id)[0]?.replyTo).toBe('help@example.test')
  expect((await entry(body.id))?.replyTo).toBe('help@example.test')
})

test('a retry sends the same attachments, copies and reply-to', async () => {
  shop.files.set(deed.key, bytes('private deed'))
  shop.mailer.failure = 'provider down'
  const { body } = await shop.document({
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    files: [
      { ...ics, text: 'BEGIN:VCALENDAR' },
      { ...deed, size: 12 },
    ],
  })
  shop.mailer.failure = undefined
  expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 1 })
  expect(sentAs(body.id)).toHaveLength(0)

  await makeDue()
  await shop.tick(fiveMinuteTick)
  expect(await entry(body.id)).toMatchObject({ status: 'sent', attempts: 2 })
  const [message] = sentAs(body.id)
  expect(message).toMatchObject({
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    attachments: [ics, { filename: 'deed.pdf', contentType: 'application/pdf' }],
  })
  expect(message?.attachments?.map((a) => text(a.content))).toEqual([
    'BEGIN:VCALENDAR',
    'private deed',
  ])
})

test('a reference attachment is fetched at every attempt and never stored', async () => {
  shop.files.set(deed.key, bytes('private deed'))
  shop.mailer.failure = 'provider down'
  const before = shop.resolved.length
  const { body } = await shop.document({
    files: [
      { ...ics, text: 'BEGIN:VCALENDAR' },
      { ...deed, size: 12 },
    ],
  })
  shop.mailer.failure = undefined
  const message = await stored(body.id)
  expect(message).toContain('"key": "deeds/7"')
  expect(message).toContain(Buffer.from('BEGIN:VCALENDAR').toString('base64'))
  expect(message).not.toContain(Buffer.from('private deed').toString('base64'))

  await makeDue()
  await shop.tick(fiveMinuteTick)
  expect(shop.resolved.slice(before)).toEqual(['deeds/7', 'deeds/7'])
  expect(await stored(body.id)).toBeNull()
})

test('a reference the resolver cannot return fails that attempt like a send error', async () => {
  shop.files.delete(deed.key)
  const { status, body } = await shop.document({ files: [{ ...deed, size: 12 }] })
  expect(status).toBe(200)
  expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 1 })
  expect((await entry(body.id))?.error).toContain('attachment "deed.pdf" could not be fetched')
  expect(sentAs(body.id)).toHaveLength(0)

  shop.files.set(deed.key, bytes('a longer private deed'))
  await makeDue()
  await shop.tick(fiveMinuteTick)
  expect(await entry(body.id)).toMatchObject({ status: 'queued', attempts: 2 })
  expect((await entry(body.id))?.error).toContain('is not the 12 bytes it was queued with')

  shop.files.set(deed.key, bytes('private deed'))
  await makeDue()
  await shop.tick(fiveMinuteTick)
  expect(await entry(body.id)).toMatchObject({ status: 'sent', attempts: 3, error: null })
  expect(text(sentAs(body.id)[0]?.attachments?.[0]?.content)).toBe('private deed')
})

test('the email log shows copies, reply-to and attachment names and sizes, never content', async () => {
  shop.files.set(deed.key, bytes('private deed'))
  shop.mailer.failure = 'provider down'
  const { body } = await shop.document({
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    files: [
      { ...ics, text: 'BEGIN:VCALENDAR' },
      { ...deed, size: 12 },
    ],
  })
  shop.mailer.failure = undefined
  const { body: page } = await shop.request('GET', '/emails/log?perPage=100')
  const row = page.rows.find((r: { id: string }) => r.id === body.id)
  expect(row).toMatchObject({
    status: 'queued',
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    replyTo: 'sender@example.test',
    attachments: [
      { filename: 'invite.ics', size: 15 },
      { filename: 'deed.pdf', size: 12 },
    ],
  })
  expect(JSON.stringify(row)).not.toContain(Buffer.from('BEGIN:VCALENDAR').toString('base64'))
  expect(Object.keys(row.attachments[0])).toEqual(['filename', 'size'])
})

test('attachments over the total size limit are refused with a clear error, nothing queued', async () => {
  const before = (await shop.log()).total
  const { status, body } = await shop.document({
    files: [
      { ...ics, text: 'BEGIN:VCALENDAR' },
      { ...deed, size: maxAttachmentsBytes - 14 },
    ],
  })
  expect(status).toBe(413)
  expect(body).toMatchObject({
    _tag: 'AttachmentsTooLarge',
    size: maxAttachmentsBytes + 1,
    limit: maxAttachmentsBytes,
    message: `The attachments add up to ${maxAttachmentsBytes + 1} bytes, over the ${maxAttachmentsBytes} byte limit.`,
  })
  expect((await shop.log()).total).toBe(before)

  shop.files.set(deed.key, new Uint8Array(maxAttachmentsBytes - 15))
  const atLimit = await shop.document({
    files: [
      { ...ics, text: 'BEGIN:VCALENDAR' },
      { ...deed, size: maxAttachmentsBytes - 15 },
    ],
  })
  expect(atLimit.status).toBe(200)
  expect(await entry(atLimit.body.id)).toMatchObject({ status: 'sent' })
})

test.each([
  ['copy address', { cc: ['not an address'] }],
  ['reply-to address', { replyTo: 'Eve <eve@example.test>\r\nBcc: x@example.test' }],
  ['file name', { files: [{ filename: '../deed.pdf', contentType: 'text/plain', text: 'x' }] }],
  [
    'content type',
    { files: [{ filename: 'a.txt', contentType: 'text/plain\r\nx: y', text: 'x' }] },
  ],
  ['reference size', { files: [{ ...deed, size: -1 }] }],
])('a send with an invalid %s is refused before anything is queued', async (_, input) => {
  const before = (await shop.log()).total
  expect((await shop.document(input)).status).toBe(500)
  expect((await shop.log()).total).toBe(before)
})
