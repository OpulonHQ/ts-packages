import { Composed, type User } from '@opulonjs/core'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'
import { superAdminRole } from '../api.ts'

/** A user with what they may do: permissions of the composed catalog, Super admin, active. */
export interface Access {
  readonly user: User
  readonly superAdmin: boolean
  readonly active: boolean
}

const AccessRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  locale: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
  superAdmin: Schema.Boolean,
  permissions: Schema.Array(Schema.String),
})

/**
 * A user's access from the database, deactivated users included (check `active`). Keys no
 * composed module declares are ignored; Super admin holds the whole catalog.
 */
export const loadAccess = Effect.fn('Users.loadAccess')(function* (id: string) {
  const sql = yield* SqlClient
  const composed = yield* Composed
  const rows = yield* sql`
    select u.id, u.name, u.email, u.admin_locale as locale, u.deactivated_at is null as active,
      coalesce(bool_or(ur.role_id = ${superAdminRole}), false) as "superAdmin",
      coalesce(jsonb_agg(distinct p) filter (where p is not null), '[]') as permissions
    from users."user" u
    left join users.user_role ur on ur.user_id = u.id
    left join users.role r on r.id = ur.role_id
    left join lateral unnest(r.permissions) as p on true
    where u.id = ${id}
    group by u.id`.pipe(Effect.orDie)
  const [row] = yield* Schema.decodeUnknownEffect(Schema.Array(AccessRow))(rows).pipe(Effect.orDie)
  if (!row) return undefined
  const held = new Set(row.permissions)
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      locale: row.locale,
      permissions: composed.permissions.filter((key) => row.superAdmin || held.has(key)),
    },
    superAdmin: row.superAdmin,
    active: row.active,
  } satisfies Access
})

// The escalation guard (TSPACK-10), shared by invitations, role edits and role assignment.

/** Whether `actor` may grant (or take away) `role`: Super admin only by a Super admin, any other
 * role only when the actor holds every catalog permission in it. */
export const canGrant = (
  actor: Access,
  role: { readonly id: string; readonly permissions: ReadonlyArray<string> },
  catalog: ReadonlyArray<string>,
) =>
  role.id === superAdminRole
    ? actor.superAdmin
    : role.permissions.every(
        (key) => !catalog.includes(key) || actor.user.permissions.includes(key),
      )

/** Whether `actor` may act on `target` at all: never on a Super admin unless one, nor on a user
 * holding a permission the actor lacks. */
export const outranks = (actor: Access, target: Access) =>
  actor.superAdmin ||
  (!target.superAdmin &&
    target.user.permissions.every((key) => actor.user.permissions.includes(key)))
