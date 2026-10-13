import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// At most one pending invitation per address: a new one replaces the old (invitations.ts).
// Invites already serialize under the users/roles lock; the index makes it a database rule.
// Duplicates left by earlier races keep only the newest link.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`delete from users.invitation i where accepted_at is null and exists (
    select 1 from users.invitation newer
    where newer.email = i.email and newer.accepted_at is null
      and (newer.created_at, newer.id) > (i.created_at, i.id))`
  yield* sql`drop index users.invitation_email`
  yield* sql`create unique index invitation_pending_email on users.invitation (email)
    where accepted_at is null`
})
