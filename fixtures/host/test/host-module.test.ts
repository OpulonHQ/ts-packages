import { EmailTemplateList } from '@opulonjs/emails/api'
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
