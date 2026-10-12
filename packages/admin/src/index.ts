export const packageName = '@opulonjs/admin'

export { useApiClient } from './api-client.ts'
export { createAdmin } from './createAdmin.ts'
export type { AdminOptions, Brand, Me } from './createAdmin.ts'
export { defineAdminModule } from './module.ts'
export type {
  Access,
  AdminModule,
  AdminRoute,
  AuthProvider,
  Lazy,
  Messages,
  NavItem,
  Widget,
} from './module.ts'
// Module screens use the shell's i18n instance through this, so they never pin vue-i18n.
export { useI18n } from 'vue-i18n'
