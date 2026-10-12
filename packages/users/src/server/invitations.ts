import { Audit } from '@opulonjs/core'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { usersBaseUrl } from './auth.ts'

/** Days an invitation link is valid. */
export const invitationDays = 7

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** SHA-256 hex of an invitation token: only the hash is stored. */
export const hashToken = (token: string) =>
  Effect.promise(async () =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  )

/** Where an emailed token lands: a public admin route; the fragment keeps it out of logs. */
export const adminLink = (route: 'accept-invitation' | 'reset-password', token: string) =>
  Effect.map(
    Effect.orDie(usersBaseUrl),
    (baseUrl) => `${new URL(baseUrl).origin}/admin/${route}#token=${encodeURIComponent(token)}`,
  )

/**
 * Creates an invitation for `email` (lowercase) with the given roles, replacing that address's
 * pending invitations, and records `users.invited`. Run it in the caller's transaction.
 * Returns the one-time token; only its hash is stored.
 */
export const createInvitation = Effect.fn('Users.createInvitation')(function* (o: {
  readonly email: string
  readonly roleIds: ReadonlyArray<string>
  readonly invitedBy: string | null
}) {
  const sql = yield* SqlClient
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const id = crypto.randomUUID()
  yield* sql`delete from users.invitation where email = ${o.email} and accepted_at is null`
  yield* sql`insert into users.invitation (id, email, role_ids, token_hash, invited_by, expires_at)
    values (${id}, ${o.email},
      array(select jsonb_array_elements_text(${JSON.stringify(o.roleIds)}::jsonb)),
      ${yield* hashToken(token)}, ${o.invitedBy},
      now() + make_interval(days => ${invitationDays}))`
  yield* Audit.record({
    action: 'users.invited',
    subject: { type: 'invitation', id, label: o.email },
    context: { roleIds: o.roleIds },
  })
  return { id, token, link: yield* adminLink('accept-invitation', token) }
})
