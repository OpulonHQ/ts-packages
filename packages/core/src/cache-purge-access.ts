import { defineExtensionPoint } from './compose.ts'

export const CachePurgeStatusAccess = defineExtensionPoint<{ readonly key: `${string}.${string}` }>(
  'core',
  'cachePurgeStatusAccess',
)

/** Declares a producer permission whose holders can read sanitized purge status. */
export const cachePurgeStatusAccess = (permission: `${string}.${string}`) =>
  CachePurgeStatusAccess.contribute({ key: permission })
