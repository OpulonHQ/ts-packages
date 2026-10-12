// Type-level tests, checked by `pnpm typecheck` (not run by vitest): permission and audit labels
// must cover the `/api` catalogs in both en and sk, or the admin module does not compile.
import { defineAdminModule, type ShellPermissionLabels } from '@opulonjs/admin'
import { corePermissions } from '@opulonjs/core/api'
import { expectTypeOf } from 'vitest'
import { demoPermissions } from '../modules/demo/api.ts'

const permissions = ['shop.orders.view', 'shop.orders.refund'] as const
const auditActions = [{ key: 'shop.order.refunded', subject: 'order' }] as const
const full = {
  permissions: { 'shop.orders.view': 'View orders', 'shop.orders.refund': 'Refund orders' },
  audit: { 'shop.order.refunded': 'Order refunded' },
}
const base = { id: 'shop', routes: [], permissions, auditActions } as const

// The shell labels exactly core's catalog.
expectTypeOf<(typeof corePermissions)[number]>().toEqualTypeOf<ShellPermissionLabels>()

// The demo module labels its catalog in en and sk.
defineAdminModule({
  id: 'demo',
  routes: [],
  permissions: demoPermissions,
  messages: {
    en: () => import('../modules/demo/admin/messages/en.ts'),
    sk: () => import('../modules/demo/admin/messages/sk.ts'),
  },
})

defineAdminModule({
  ...base,
  messages: { en: async () => ({ default: full }), sk: async () => ({ default: full }) },
})

defineAdminModule({
  ...base,
  messages: {
    en: async () => ({ default: full }),
    // @ts-expect-error sk lacks a permission label
    sk: async () => ({
      default: { ...full, permissions: { 'shop.orders.view': 'Zobraziť objednávky' } },
    }),
  },
})

defineAdminModule({
  ...base,
  messages: {
    // @ts-expect-error en lacks the audit labels
    en: async () => ({ default: { permissions: full.permissions } }),
    sk: async () => ({ default: full }),
  },
})

// A module without catalogs needs no labels.
defineAdminModule({
  id: 'plain',
  routes: [],
  messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
})
