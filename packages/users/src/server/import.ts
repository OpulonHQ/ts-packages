import { Audit, withTransaction } from '@opulonjs/core'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { lockAccessWrites } from './access.ts'
import { isVerifiableHash } from './password.ts'
import { addressPattern, normalizeEmail } from './service.ts'

/** A user of another system, as `importUsers` takes it. */
export interface ImportedUser {
  readonly email: string
  readonly name: string
  /** The hash the other system stored: bcrypt (`$2a$`, `$2b$`, `$2y$`) or this package's own format. */
  readonly passwordHash: string
  /** Ids of existing roles: `super_admin`, or an id the Roles screen or `GET /api/users/roles` shows. */
  readonly roleIds: ReadonlyArray<string>
}

/**
 * Creates active, verified users with the password hash and roles they had in another system, and
 * resolves with their ids in the given order. All or nothing: it fails, naming the address, on an
 * invalid email, a hash sign-in cannot verify, an unknown role or an address already in use.
 * A bcrypt hash is replaced by the current format when its user first signs in. For a host command
 * (`opulon <module> <command>`) or script; it grants roles without an escalation check.
 */
export const importUsers = Effect.fn('Users.importUsers')(function* (
  users: ReadonlyArray<ImportedUser>,
) {
  const sql = yield* SqlClient
  return yield* withTransaction(
    Effect.gen(function* () {
      yield* lockAccessWrites
      const roles = new Set(
        (yield* sql<{ id: string }>`select id from users.role`).map((r) => r.id),
      )
      const ids: Array<string> = []
      for (const user of users) {
        const email = normalizeEmail(user.email)
        const refuse = (why: string) => Effect.fail(new Error(`${email}: ${why}`))
        if (!addressPattern.test(email)) return yield* refuse('not an email address')
        if (!isVerifiableHash(user.passwordHash))
          return yield* refuse('the password hash is neither bcrypt nor pbkdf2v1')
        const roleIds = [...new Set(user.roleIds)]
        const unknown = roleIds.find((id) => !roles.has(id))
        if (unknown !== undefined) return yield* refuse(`unknown role ${unknown}`)
        const [taken] = yield* sql`select 1 from users."user" where email = ${email}`
        if (taken) return yield* refuse('a user with this address exists')
        const id = crypto.randomUUID()
        yield* sql`insert into users."user" (id, name, email, email_verified)
          values (${id}, ${user.name}, ${email}, true)`
        yield* sql`insert into users.account (id, account_id, provider_id, user_id, password,
            updated_at)
          values (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${user.passwordHash}, now())`
        yield* sql`insert into users.user_role (user_id, role_id)
          select ${id}, jsonb_array_elements_text(${JSON.stringify(roleIds)}::jsonb)`
        yield* Audit.record({
          action: 'users.imported',
          subject: { type: 'user', id, label: email },
          context: { roleIds },
        })
        ids.push(id)
      }
      return ids
    }),
  )
})
