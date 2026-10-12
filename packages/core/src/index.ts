export const packageName = '@opulonjs/core'

export { authorization, Authorization, CurrentUser, Policy, Public } from './authz.ts'
export { composeServer, CompositionError } from './compose.ts'
export type { ComposedServer, Unprovided } from './compose.ts'
export { migrate } from './migrate.ts'
export type { Applied } from './migrate.ts'
export { defineModule } from './module.ts'
export type { AuditAction, Migrations, Module, ModuleDefinition } from './module.ts'
