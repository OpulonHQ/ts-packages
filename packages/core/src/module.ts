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

/**
 * A scheduled task. The 5-minute cron runs it when its UTC bucket starts at the tick's scheduled
 * time (every 5 minutes, at the top of each hour, or at midnight UTC); a missed tick is skipped.
 * It runs as the system actor and must be idempotent and bounded.
 */
export interface Task<R = never> {
  /** Unique within the module; logged as `<module id>.<name>`. */
  readonly name: string
  readonly every: '5m' | '1h' | '1d'
  readonly run: Effect.Effect<void, unknown, R>
}

export interface ModuleDefinition<
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
  ROut,
  RIn,
  RHandlers,
  RTasks,
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
  readonly tasks?: ReadonlyArray<Task<RTasks>>
}

/**
 * A module as composition sees it. Phantom types: what its layer provides, what its layer needs
 * (from upstream modules or infra) and what its handlers and tasks need (from any module or infra).
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
  readonly tasks: ReadonlyArray<Task<unknown>>
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
  RTasks = never,
>(
  m: ModuleDefinition<Id, Groups, ROut, RIn, RHandlers, RTasks>,
): Module<Id, ROut, RIn, RHandlers | RTasks> => ({
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
  tasks: m.tasks ?? [],
})
