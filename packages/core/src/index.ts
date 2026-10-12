export const packageName = '@opulonjs/core'

export {
  authorization,
  Authorization,
  CurrentActor,
  CurrentUser,
  Policy,
  Public,
  systemActor,
} from './authz.ts'
export type { Actor } from './authz.ts'
export { Background, withTransaction } from './background.ts'
export { composeServer, CompositionError } from './compose.ts'
export type { ComposedServer, Unprovided } from './compose.ts'
export { migrate } from './migrate.ts'
export type { Applied } from './migrate.ts'
export { defineModule } from './module.ts'
export type { AuditAction, Migrations, Module, ModuleDefinition, Task } from './module.ts'
