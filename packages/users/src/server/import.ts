import { Audit, withTransaction } from '@opulonjs/core'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import * as z from 'zod'
import { Email } from '../api.ts'
import { lockAccessWrites } from './access.ts'
import { isVerifiableHash } from './password.ts'
import { normalizeEmail } from './invitations.ts'

const Row = Schema.Struct({
  email: Email.check(
    Schema.makeFilter(
      (email: string) =>
        z.email().safeParse(normalizeEmail(email)).success ||
        'not an email address sign-in accepts',
    ),
  ),
  name: Schema.String,
  passwordHash: Schema.String.check(
    Schema.makeFilter(
      (hash: string) =>
        isVerifiableHash(hash) || 'the password hash is neither bcrypt nor pbkdf2v1',
    ),
  ),
  roleIds: Schema.Array(Schema.String),
})

/** A user of another system, as `importUsers` takes it. */
export interface ImportedUser {
  /** An address sign-in accepts; stored trimmed and lowercased. */
  readonly email: string
  readonly name: string
  /** The hash the other system stored: bcrypt (`$2a$`, `$2b$`, `$2y$`) or this package's own format. */
  readonly passwordHash: string
  /** Ids of existing roles: `super_admin`, or an `id` from `GET /api/users/roles`. */
  readonly roleIds: ReadonlyArray<string>
}

const label = (row: unknown, index: number) =>
  typeof row === 'object' && row !== null && 'email' in row && typeof row.email === 'string'
    ? `user ${index + 1} (${normalizeEmail(row.email)})`
    : `user ${index + 1}`

/**
 * Creates active, verified users with the password hash and roles they had in another system, and
 * resolves with their ids in the given order. The rows are checked as untrusted data, so parsed
 * JSON can be passed as it is. All or nothing: it fails, naming the row, when a row is malformed,
 * its address or its hash is one sign-in would not accept, a role does not exist or the address is
 * already in use. A bcrypt hash is replaced by the current format when its user first signs in.
 * For a host command (`opulon <module> <command>`) or script; it grants roles without an
 * escalation check.
 */
export const importUsers = Effect.fn('Users.importUsers')(function* (
  users: ReadonlyArray<ImportedUser>,
) {
  const sql = yield* SqlClient
  if (!Array.isArray(users)) return yield* Effect.fail(new Error('expected an array of users'))
  const rows = yield* Effect.forEach(users, (row: unknown, index) =>
    Schema.decodeUnknownEffect(Row)(row).pipe(
      Effect.mapError(
        (error) => new Error(`${label(row, index)}: ${error.message.replace(/\n\s*/g, ' ')}`),
      ),
    ),
  )
  return yield* withTransaction(
    Effect.gen(function* () {
      yield* lockAccessWrites
      const roles = new Set(
        (yield* sql<{ id: string }>`select id from users.role`).map((r) => r.id),
      )
      const ids: Array<string> = []
      for (const [index, user] of rows.entries()) {
        const email = normalizeEmail(user.email)
        const refuse = (why: string) => Effect.fail(new Error(`${label(user, index)}: ${why}`))
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
