import {
  Audit,
  Background,
  Composed,
  CurrentUser,
  diffFields,
  requirePermission,
  withTransaction,
} from '@opulonjs/core'
import { listDefaultPerPage } from '@opulonjs/core/api'
import { Context, Effect, Layer, Schema } from 'effect'
import { BadRequest, Conflict, Forbidden, NotFound } from 'effect/http-api/HttpApiError'
import { SqlClient } from 'effect/sql/SqlClient'
import { Refused, type RoleInfo, superAdminRole, UserList, type UserQuery } from '../api.ts'
import { type Access, canGrant, loadAccess, lockAccessWrites, outranks } from './access.ts'

/** Permissions nobody may take from themselves (no self-lockout). */
const lockoutKeys = ['users.manage', 'users.roles.manage'] as const

const permissionList = (keys: ReadonlyArray<string>) => [...keys].sort().join(', ')

type RoleRow = { id: string; name: string; permissions: ReadonlyArray<string>; built_in: boolean }

/** Users and roles administration: the users list, roles, assignment, deactivation, locale. */
export class UserManagement extends Context.Service<
  UserManagement,
  {
    readonly users: (query: UserQuery) => Effect.Effect<UserList, Forbidden>
    readonly roles: () => Effect.Effect<{ readonly roles: ReadonlyArray<RoleInfo> }, Forbidden>
    readonly createRole: (input: {
      readonly name: string
      readonly permissions: ReadonlyArray<string>
    }) => Effect.Effect<
      { readonly id: string },
      BadRequest | Conflict | Forbidden | Refused,
      CurrentUser
    >
    readonly updateRole: (
      id: string,
      input: { readonly name: string; readonly permissions: ReadonlyArray<string> },
    ) => Effect.Effect<void, BadRequest | Conflict | NotFound | Forbidden | Refused, CurrentUser>
    readonly assignRoles: (
      userId: string,
      roleIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, BadRequest | NotFound | Forbidden | Refused, CurrentUser>
    readonly setActive: (
      userId: string,
      active: boolean,
    ) => Effect.Effect<void, NotFound | Forbidden | Refused, CurrentUser>
    readonly setLocale: (
      userId: string,
      locale: string | null,
    ) => Effect.Effect<void, NotFound | Forbidden | Refused, CurrentUser>
  }
>()('@opulonjs/users/UserManagement') {
  static readonly layer = Layer.effect(
    UserManagement,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const background = yield* Background
      const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(SqlClient, sql),
          Effect.provideService(Background, background),
        )

      /** Active users holding Super admin. */
      const superAdmins = Effect.map(
        sql<{ n: number }>`select count(*)::int as n
          from users.user_role ur join users."user" u on u.id = ur.user_id
          where ur.role_id = ${superAdminRole} and u.deactivated_at is null`,
        ([row]) => row?.n ?? 0,
      )

      /**
       * Runs a users or roles change in a transaction that first takes one lock shared by every
       * such change, then re-reads the actor (their request-time permissions may be stale), and
       * afterwards refuses the result if it locked the actor out or left no active Super admin.
       * The lock makes those checks race-free: two admins demoting each other run one after the
       * other, and the second sees the first's outcome.
       */
      const guarded = <A, E>(
        required: (typeof lockoutKeys)[number],
        change: (
          actor: Access,
          catalog: ReadonlyArray<string>,
        ) => Effect.Effect<A, E, SqlClient | CurrentUser>,
      ) =>
        provide(
          withTransaction(
            Effect.gen(function* () {
              const me = yield* CurrentUser
              yield* lockAccessWrites
              const holdersBefore = yield* superAdmins
              const actor = yield* loadAccess(me.id)
              if (!actor?.active || !actor.user.permissions.includes(required))
                return yield* new Forbidden()
              const result = yield* change(actor, (yield* Composed).permissions)
              const after = yield* loadAccess(me.id)
              const kept = lockoutKeys.filter((key) => actor.user.permissions.includes(key))
              if (!after?.active || kept.some((key) => !after.user.permissions.includes(key)))
                return yield* new Refused({ reason: 'self_lockout' })
              if (holdersBefore > 0 && (yield* superAdmins) === 0)
                return yield* new Refused({ reason: 'last_super_admin' })
              return result
            }),
          ).pipe(Effect.catchTag('SqlError', Effect.die)),
        )

      const target = Effect.fn('UserManagement.target')(function* (actor: Access, id: string) {
        const found = yield* loadAccess(id)
        if (!found) return yield* new NotFound()
        if (!outranks(actor, found)) return yield* new Refused({ reason: 'outranked' })
        return found
      })

      const rolesById = (ids: ReadonlyArray<string>) =>
        sql<RoleRow>`select id, name, to_jsonb(permissions) as permissions, built_in
          from users.role
          where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`

      /** Keys outside the catalog are refused on write. */
      const declared = (keys: ReadonlyArray<string>, catalog: ReadonlyArray<string>) =>
        keys.every((key) => catalog.includes(key))
          ? Effect.succeed([...new Set(keys)].sort())
          : Effect.fail(new BadRequest())

      const nameTaken = (name: string, except: string | null) =>
        Effect.map(
          sql`select 1 from users.role where name = ${name} and id is distinct from ${except}`,
          (rows) => rows.length > 0,
        )

      const userLabel = (a: Access) => a.user.email

      return UserManagement.of({
        users: Effect.fn('UserManagement.users')(
          function* (query) {
            yield* requirePermission('users.manage')
            const page = query.page ?? 1
            const perPage = query.perPage ?? listDefaultPerPage
            const search = query.search?.trim()
            const orderColumn = {
              name: sql`lower(name)`,
              email: sql`email`,
              deactivated: sql`(deactivated_at is not null)`,
            }[query.sort ?? 'name']
            const direction = query.direction === 'desc' ? sql`desc` : sql`asc`
            const order = sql`${orderColumn} ${direction}, id ${direction}`
            const where = sql.and([
              sql`true`,
              ...(query.id !== undefined ? [sql`id = ${query.id}`] : []),
              ...(search
                ? [
                    sql`(strpos(lower(name), lower(${search})) > 0 or strpos(lower(email), lower(${search})) > 0)`,
                  ]
                : []),
            ])
            const rows = yield* sql`with filtered as not materialized (
              select * from users."user" where ${where}
            ), paged as (
              select * from filtered order by ${order} limit ${perPage} offset ${(page - 1) * perPage}
            ) select (select count(*)::float8 from filtered) as total,
              coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'email', email, 'locale', admin_locale,
                'deactivated', deactivated_at is not null,
                'roleIds', coalesce((select jsonb_agg(role_id order by role_id)
                  from users.user_role where user_id = paged.id), '[]'::jsonb)
              ) order by ${order}) from paged), '[]'::jsonb) as users,
              coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)
                order by built_in desc, lower(name), id) from users.role), '[]'::jsonb) as roles`
            return yield* Schema.decodeUnknownEffect(UserList)(rows[0])
          },
          provide,
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        ),

        roles: Effect.fn('UserManagement.roles')(
          function* () {
            yield* requirePermission('users.roles.manage')
            const roles = yield* sql<RoleInfo>`
            select r.id, r.name, to_jsonb(r.permissions) as permissions, r.built_in as "builtIn",
              (select count(*)::int from users.user_role ur join users."user" u on u.id = ur.user_id
                where ur.role_id = r.id and u.deactivated_at is null) as holders
            from users.role r order by r.built_in desc, lower(r.name)`
            return { roles }
          },
          provide,
          Effect.orDie,
        ),

        createRole: Effect.fn('UserManagement.createRole')(function* (input) {
          return yield* guarded('users.roles.manage', (actor, catalog) =>
            Effect.gen(function* () {
              const permissions = yield* declared(input.permissions, catalog)
              if (!canGrant(actor, { id: '', permissions }, catalog))
                return yield* new Refused({ reason: 'escalation' })
              if (yield* nameTaken(input.name, null)) return yield* new Conflict()
              const id = crypto.randomUUID()
              yield* sql`insert into users.role (id, name, permissions)
                values (${id}, ${input.name},
                  array(select jsonb_array_elements_text(${JSON.stringify(permissions)}::jsonb)))`
              yield* Audit.record({
                action: 'users.role_created',
                subject: { type: 'role', id, label: input.name },
                changes: [
                  { field: 'name', from: null, to: input.name },
                  { field: 'permissions', from: null, to: permissionList(permissions) },
                ],
              })
              return { id }
            }),
          )
        }),

        updateRole: Effect.fn('UserManagement.updateRole')(function* (id, input) {
          return yield* guarded('users.roles.manage', (actor, catalog) =>
            Effect.gen(function* () {
              const [role] = yield* sql<RoleRow>`select id, name,
                to_jsonb(permissions) as permissions, built_in from users.role where id = ${id}`
              if (!role) return yield* new NotFound()
              if (role.built_in) return yield* new Refused({ reason: 'built_in' })
              const granted = yield* declared(input.permissions, catalog)
              // Neither grant what you lack nor edit a role holding what you lack.
              if (
                !canGrant(actor, role, catalog) ||
                !canGrant(actor, { id, permissions: granted }, catalog)
              )
                return yield* new Refused({ reason: 'escalation' })
              if (yield* nameTaken(input.name, id)) return yield* new Conflict()
              // Undeclared keys stay stored (a module may come back) and still grant nothing.
              const kept = role.permissions.filter((key) => !catalog.includes(key))
              const permissions = [...new Set([...granted, ...kept])].sort()
              yield* sql`update users.role set name = ${input.name},
                permissions = array(select jsonb_array_elements_text(
                  ${JSON.stringify(permissions)}::jsonb))
                where id = ${id}`
              const changes = diffFields(
                { name: role.name, permissions: permissionList(role.permissions) },
                { name: input.name, permissions: permissionList(permissions) },
                ['name', 'permissions'],
              )
              if (changes.length > 0)
                yield* Audit.record({
                  action: 'users.role_updated',
                  subject: { type: 'role', id, label: input.name },
                  changes,
                })
            }),
          )
        }),

        assignRoles: Effect.fn('UserManagement.assignRoles')(function* (userId, roleIds) {
          return yield* guarded('users.manage', (actor, catalog) =>
            Effect.gen(function* () {
              const wanted = [...new Set(roleIds)]
              const roles = yield* rolesById(wanted)
              if (roles.length !== wanted.length) return yield* new BadRequest()
              const subject = yield* target(actor, userId)
              const current = yield* sql<RoleRow>`select r.id, r.name,
                to_jsonb(r.permissions) as permissions, r.built_in
                from users.user_role ur join users.role r on r.id = ur.role_id
                where ur.user_id = ${userId}`
              const added = roles.filter((r) => !current.some((c) => c.id === r.id))
              const removed = current.filter((c) => !wanted.includes(c.id))
              if ([...added, ...removed].some((role) => !canGrant(actor, role, catalog)))
                return yield* new Refused({ reason: 'escalation' })
              if (added.length === 0 && removed.length === 0) return
              yield* sql`delete from users.user_role where user_id = ${userId}`
              yield* sql`insert into users.user_role (user_id, role_id)
                select ${userId}, id from users.role
                where id in (select jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb))`
              const names = (list: ReadonlyArray<{ name: string }>) =>
                list
                  .map((r) => r.name)
                  .sort()
                  .join(', ')
              yield* Audit.record({
                action: 'users.roles_assigned',
                subject: { type: 'user', id: userId, label: userLabel(subject) },
                changes: [{ field: 'roles', from: names(current), to: names(roles) }],
              })
            }),
          )
        }),

        setActive: Effect.fn('UserManagement.setActive')(function* (userId, active) {
          return yield* guarded('users.manage', (actor) =>
            Effect.gen(function* () {
              if (!active && userId === actor.user.id)
                return yield* new Refused({ reason: 'self_lockout' })
              const subject = yield* target(actor, userId)
              if (subject.active === active) return
              yield* sql`update users."user"
                set deactivated_at = case when ${active} then null else now() end,
                  updated_at = now()
                where id = ${userId}`
              // Open sessions end now, and stay ended after a reactivation.
              if (!active) yield* sql`delete from users.session where user_id = ${userId}`
              yield* Audit.record({
                action: active ? 'users.reactivated' : 'users.deactivated',
                subject: { type: 'user', id: userId, label: userLabel(subject) },
              })
            }),
          )
        }),

        setLocale: Effect.fn('UserManagement.setLocale')(function* (userId, locale) {
          const me = yield* CurrentUser
          const change = (actor: Access) =>
            Effect.gen(function* () {
              const subject = userId === actor.user.id ? actor : yield* target(actor, userId)
              if (subject.user.locale === locale) return
              yield* sql`update users."user" set admin_locale = ${locale}, updated_at = now()
                where id = ${userId}`
              yield* Audit.record({
                action: 'users.locale_changed',
                subject: { type: 'user', id: userId, label: userLabel(subject) },
                changes: [{ field: 'locale', from: subject.user.locale, to: locale }],
              })
            })
          if (userId !== me.id) return yield* guarded('users.manage', change)
          // Your own locale needs no permission and cannot lock anyone out.
          return yield* provide(
            withTransaction(
              Effect.gen(function* () {
                const self = yield* loadAccess(me.id)
                if (!self?.active) return yield* new Forbidden()
                yield* change(self)
              }),
            ).pipe(Effect.catchTag('SqlError', Effect.die)),
          )
        }),
      })
    }),
  )
}
