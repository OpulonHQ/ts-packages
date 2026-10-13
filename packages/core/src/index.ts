export const packageName = '@opulonjs/core'

export {
  authorization,
  Authorization,
  CurrentActor,
  CurrentUser,
  Policy,
  Public,
  requirePermission,
  systemActor,
} from './authz.ts'
export type { Actor, User } from './authz.ts'
export { Audit, diffFields } from './audit.ts'
export type { AuditChange, AuditInput } from './audit.ts'
export { Background, withTransaction } from './background.ts'
export { core } from './core.ts'
export type { CoreOptions } from './core.ts'
export {
  Composed,
  composeServer,
  CompositionError,
  ContentLocales,
  defineExtensionPoint,
} from './compose.ts'
export type { ComposedServer, Unprovided } from './compose.ts'
export { migrate } from './migrate.ts'
export type { Applied } from './migrate.ts'
export { defineModule } from './module.ts'
export type {
  AuditAction,
  Command,
  Contribution,
  Migrations,
  Module,
  ModuleDefinition,
  Task,
} from './module.ts'
