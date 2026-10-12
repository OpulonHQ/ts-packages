import type { Effect, Layer } from 'effect'
import type * as HttpApi from 'effect/http-api/HttpApi'
import type * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import type { SqlClient } from 'effect/sql/SqlClient'

/** Identifier of the composed HttpApi. Group services carry it in their type. */
export const apiId = 'opulon'
export type ApiId = typeof apiId

/** Migrations keyed `<id>_<name>`; ids are append-only and strictly increasing. */
export type Migrations = Readonly<Record<string, Effect.Effect<void, unknown, SqlClient>>>

export interface AuditAction<Id extends string> {
  readonly key: `${Id}.${string}`
  readonly subject: string
}

export interface ModuleDefinition<
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
  ROut,
  RIn,
  RHandlers,
> {
  readonly id: Id
  readonly dependsOn?: ReadonlyArray<string>
  readonly groups: ReadonlyArray<Groups>
  /**
   * Builds the group handlers against the composed API. `api` holds only this module's groups,
   * already prefixed with the API prefix and `/<id>`.
   */
  readonly handlers: (
    api: HttpApi.HttpApi<ApiId, Groups>,
  ) => Layer.Layer<HttpApiGroup.ToService<ApiId, Groups>, unknown, RHandlers>
  readonly layer?: Layer.Layer<ROut, unknown, RIn>
  readonly migrations?: Migrations
  readonly permissions?: ReadonlyArray<`${Id}.${string}`>
  readonly auditActions?: ReadonlyArray<AuditAction<Id>>
}

/**
 * A module as composition sees it. Phantom types: what its layer provides, what its layer needs
 * (from upstream modules or infra) and what its handlers need (from any module or infra).
 */
export interface Module<
  Id extends string = string,
  Provides = unknown,
  Requires = unknown,
  HandlerRequires = unknown,
> {
  readonly id: Id
  readonly dependsOn: ReadonlyArray<string>
  readonly groups: ReadonlyArray<HttpApiGroup.Constraint>
  readonly handlers: (api: HttpApi.Top) => Layer.Layer<never, unknown, unknown>
  readonly layer: Layer.Layer<never, unknown, unknown> | undefined
  readonly migrations: Migrations
  readonly permissions: ReadonlyArray<string>
  readonly auditActions: ReadonlyArray<{ readonly key: string; readonly subject: string }>
  readonly '~provides'?: Provides
  readonly '~requires'?: Requires
  readonly '~handlerRequires'?: HandlerRequires
}

/** Describes a module (package or host module) for the server. */
export const defineModule = <
  const Id extends string,
  Groups extends HttpApiGroup.Constraint,
  ROut = never,
  RIn = never,
  RHandlers = never,
>(
  m: ModuleDefinition<Id, Groups, ROut, RIn, RHandlers>,
): Module<Id, ROut, RIn, RHandlers> => ({
  id: m.id,
  dependsOn: m.dependsOn ?? [],
  groups: m.groups,
  // Safe: composition passes an API holding exactly this module's (prefixed) groups, which is
  // what the narrower parameter type promises; HttpApi's invariant group type needs the cast.
  handlers: m.handlers as unknown as Module['handlers'],
  layer: m.layer,
  migrations: m.migrations ?? {},
  permissions: m.permissions ?? [],
  auditActions: m.auditActions ?? [],
})
