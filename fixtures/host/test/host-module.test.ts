import { EmailLogPage, EmailTemplateList } from '@opulonjs/emails/api'
import { Schema } from 'effect'
import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

test('the demo host module contributes an email template next to the packages ones', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const cookie = await host.signIn(owner.email, owner.password)
  const response = await host.request('GET', '/emails/templates', { cookie })
  expect(response.status).toBe(200)
  const { templates } = Schema.decodeUnknownSync(EmailTemplateList)(response.body)
  expect(templates.find((t) => t.key === 'demo.note_shared')).toMatchObject({
    audience: 'public',
    placeholders: [{ name: 'note', sample: 'Hello' }],
  })
  expect(templates.map((t) => t.key)).toEqual(
    expect.arrayContaining(['users.invitation', 'demo.note_shared']),
  )
})

test('sharing a note emails it with a stored and a fetched attachment, and logs both by name', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const cookie = await host.signIn(owner.email, owner.password)
  const shared = await host.request('POST', '/demo/notes/share', {
    cookie,
    body: {
      to: 'jana@example.test',
      cc: ['copy@example.test'],
      replyTo: 'sender@example.test',
      note: 'Hello Jana',
    },
  })
  expect(shared.status).toBe(200)
  const message = host.mailer.sent.find((m) => m.to.includes('jana@example.test'))
  expect(message).toMatchObject({ cc: ['copy@example.test'], replyTo: 'sender@example.test' })
  expect(
    message?.attachments?.map((a) => [a.filename, new TextDecoder().decode(a.content)]),
  ).toEqual([
    ['note.txt', 'Hello Jana'],
    ['private.txt', 'Fetched at send time, never stored in the email log.'],
  ])
  const log = await host.request('GET', '/emails/log', { cookie })
  const { rows } = Schema.decodeUnknownSync(EmailLogPage)(log.body)
  expect(rows.find((r) => r.recipients.includes('jana@example.test'))).toMatchObject({
    status: 'sent',
    cc: ['copy@example.test'],
    bcc: [],
    replyTo: 'sender@example.test',
    attachments: [
      { filename: 'note.txt', size: 10 },
      { filename: 'private.txt', size: 52 },
    ],
  })
})
