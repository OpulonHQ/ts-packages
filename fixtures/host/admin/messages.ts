import type { Labels } from '@opulonjs/admin'
import type { hostPermissions } from '../server/permissions.ts'

type HostLabels = Labels<(typeof hostPermissions)[number]>

export const hostMessages = {
  en: { permissions: { 'shop.orders.view': 'View orders' } satisfies HostLabels },
  sk: { permissions: { 'shop.orders.view': 'Zobraziť objednávky' } satisfies HostLabels },
}
