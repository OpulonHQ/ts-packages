import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser, sqlQuery, tokenFrom } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

interface Event {
  action: string
  actor_kind: string
  actor_id: string | null
  subject_type: string | null
  subject_id: string | null
  ip: string | null
  user_agent: string | null
}

const events = (action: string) =>
  sqlQuery<Event>(
    db.url,
    `select action, actor_kind, actor_id, subject_type, subject_id, ip, user_agent
     from core.audit_event where action = $1 order by id`,
    [action],
  )

test('sign-in, failed sign-in and sign-out are users.* audit events with actor, IP and UA', async () => {
  const user = await seedUser(db.url)
  await host.request('POST', '/users/auth/sign-in', {
    body: { email: user.email, password: 'wrong password' },
    ip: '10.9.9.9',
  })
  await host.request('POST', '/users/auth/sign-in', {
    body: { email: 'ghost@example.test', password: 'wrong password' },
  })
  const cookie = await host.signIn(user.email, user.password, '10.1.2.3')
  await host.request('POST', '/users/auth/sign-out', { cookie })

  expect(await events('users.sign_in_failed')).toEqual([
    expect.objectContaining({
      actor_kind: 'anonymous',
      subject_type: 'user',
      subject_id: user.id,
      ip: '10.9.9.9',
      user_agent: 'vitest',
    }),
    expect.objectContaining({ actor_kind: 'anonymous', subject_id: null }),
  ])
  expect(await events('users.signed_in')).toEqual([
    expect.objectContaining({
      actor_kind: 'user',
      actor_id: user.id,
      subject_id: user.id,
      ip: '10.1.2.3',
    }),
  ])
  expect(await events('users.signed_out')).toEqual([
    expect.objectContaining({ actor_kind: 'user', actor_id: user.id, subject_id: user.id }),
  ])
})

test('invitation, acceptance, reset request and reset are users.* audit events', async () => {
  const admin = await seedUser(db.url, { superAdmin: true })
  const cookie = await host.signIn(admin.email, admin.password)
  await host.request('POST', '/users/invitations', {
    cookie,
    body: { email: 'new@example.test', roleIds: [] },
  })
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  const secrets = [admin.password, token, 'new user password', 'newer password 2']
  await host.request('POST', '/users/invitations/accept', {
    body: { token, name: 'New', password: 'new user password' },
  })
  await host.request('POST', '/users/auth/request-password-reset', {
    body: { email: 'new@example.test' },
  })
  const resetToken = tokenFrom(host.mailer.sent.at(-1)!.html)
  secrets.push(resetToken)
  await host.request('POST', '/users/auth/reset-password', {
    body: { token: resetToken, password: 'newer password 2' },
  })

  const [invited] = await events('users.invited')
  expect(invited).toMatchObject({
    actor_kind: 'user',
    actor_id: admin.id,
    subject_type: 'invitation',
  })
  const [accepted] = await events('users.invitation_accepted')
  expect(accepted).toMatchObject({ actor_kind: 'user', subject_type: 'user' })
  const newUser = accepted!.subject_id
  expect(await events('users.password_reset_requested')).toEqual([
    expect.objectContaining({ subject_id: newUser }),
  ])
  expect(await events('users.password_reset')).toEqual([
    expect.objectContaining({ actor_kind: 'user', actor_id: newUser, subject_id: newUser }),
  ])
  // No password or token ever lands in the audit log.
  const rows = await sqlQuery<{ row: string }>(
    db.url,
    'select row_to_json(e)::text as row from core.audit_event e',
  )
  for (const { row } of rows) for (const secret of secrets) expect(row).not.toContain(secret)
})
