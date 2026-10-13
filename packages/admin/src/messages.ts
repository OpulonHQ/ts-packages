import type { Labels, Messages } from './module.ts'

// Core's permission catalog (`corePermissions` in @opulonjs/core/api, which the admin may not
// import); fixtures/host/test/labels.test-d.ts checks these labels cover it.
type CorePermission = 'core.audit.view'

const en = {
  admin: {
    dashboard: 'Dashboard',
    dashboardEmpty: 'Nothing to show here yet.',
    loading: 'Loading…',
    signOut: 'Sign out',
    meFailed: 'The admin could not reach the server. Try reloading the page.',
    notFound: 'Page not found.',
    navigation: 'Main navigation',
    reload: { message: 'A new admin version is available.', action: 'Reload' },
    groups: { content: 'Content', users: 'Users', settings: 'Settings' },
  },
  permissions: { 'core.audit.view': 'View the audit log' } satisfies Labels<CorePermission>,
} satisfies Messages

const sk: typeof en = {
  admin: {
    dashboard: 'Prehľad',
    dashboardEmpty: 'Zatiaľ tu nič nie je.',
    loading: 'Načítava sa…',
    signOut: 'Odhlásiť sa',
    meFailed: 'Administrácia sa nevie spojiť so serverom. Skúste stránku obnoviť.',
    notFound: 'Stránka sa nenašla.',
    navigation: 'Hlavná navigácia',
    reload: { message: 'Je dostupná nová verzia administrácie.', action: 'Obnoviť' },
    groups: { content: 'Obsah', users: 'Používatelia', settings: 'Nastavenia' },
  },
  permissions: { 'core.audit.view': 'Zobraziť auditný záznam' },
}

/** Permission keys the shell labels (core's catalog). */
export type ShellPermissionLabels = keyof typeof en.permissions

/** The shell's own catalogs (`admin.*`, core's `permissions.*`); hosts extend or override them. */
export const shellMessages: Readonly<Record<'en' | 'sk', Messages>> = { en, sk }
