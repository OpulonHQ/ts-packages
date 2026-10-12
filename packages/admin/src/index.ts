export const packageName = '@opulonjs/admin'

export { useApiClient } from './api-client.ts'
export { createAdmin } from './createAdmin.ts'
export type { AdminOptions } from './createAdmin.ts'
export type { ShellPermissionLabels } from './messages.ts'
export { defineAdminModule } from './module.ts'
export type {
  Access,
  AdminModule,
  AdminRoute,
  AuthProvider,
  Labels,
  Lazy,
  Messages,
  ModuleMessages,
  NavGroup,
  NavItem,
  Widget,
} from './module.ts'
export { useAdmin } from './state.ts'
export type { AdminState, Me } from './state.ts'
export type { Brand } from '@opulonjs/ui'
// Module screens use the shell's i18n instance and router through these, so they never pin
// vue-i18n or vue-router.
export { useI18n } from 'vue-i18n'
export { useRoute, useRouter } from 'vue-router'
