import type { Labels, Messages } from './module.ts'
import type { corePermissions } from '@opulonjs/core/api'

type CorePermission = (typeof corePermissions)[number]

const en = {
  admin: {
    dashboard: 'Dashboard',
    dashboardEmpty: 'Nothing to show here yet.',
    loading: 'Loading…',
    signOut: 'Sign out',
    userMenu: 'User menu',
    account: 'Account settings',
    language: 'Language',
    languageFailed: 'The language could not be saved. Try again.',
    meFailed: 'The admin could not reach the server. Try reloading the page.',
    screenFailed: { message: 'This screen could not be loaded.', action: 'Try again' },
    notFound: 'Page not found.',
    navigation: 'Main navigation',
    reload: { message: 'A new admin version is available.', action: 'Reload' },
    groups: { content: 'Content', users: 'Users', settings: 'Settings' },
    audit: {
      title: 'Audit log',
      description:
        'Newest events first. Actor and subject names are snapshots from the time of the event.',
      timeline: 'Audit timeline',
      event: 'Event',
      filters: {
        actor: 'Actor',
        module: 'Module',
        action: 'Action',
        subjectType: 'Subject type',
        subjectId: 'Subject ID',
        subjectLabel: 'Subject label',
        start: 'From date (UTC)',
        end: 'Through date (UTC)',
      },
      filterHelp:
        'Actor searches kind, ID or name. Subject label searches text. Module, action, subject type and ID match exactly. Both dates include the whole day in UTC.',
      apply: 'Apply filters',
      reset: 'Reset filters',
      invalidRange: 'Enter a valid date range with the end on or after the start.',
      invalidThrough: 'Enter a Through date on or before 9999-12-30.',
      empty: 'No audit events match.',
      failed: 'The audit events could not be loaded. Try again.',
      retry: 'Retry',
      actors: { user: 'User', system: 'System', anonymous: 'Anonymous' },
      from: 'From',
      to: 'To',
      ip: 'IP address',
      userAgent: 'User agent',
      previous: 'Previous events',
      next: 'Next events',
      page: 'Page {page} of {pages}',
      depthLimit:
        'Only the newest {count} matching events can be paged. Use filters in the Audit log to see older history.',
    },
  },
  permissions: { 'core.audit.view': 'View the audit log' } satisfies Labels<CorePermission>,
} satisfies Messages

const sk: typeof en = {
  admin: {
    dashboard: 'Prehľad',
    dashboardEmpty: 'Zatiaľ tu nič nie je.',
    loading: 'Načítava sa…',
    signOut: 'Odhlásiť sa',
    userMenu: 'Používateľské menu',
    account: 'Nastavenia účtu',
    language: 'Jazyk',
    languageFailed: 'Jazyk sa nepodarilo uložiť. Skúste to znova.',
    meFailed: 'Administrácia sa nevie spojiť so serverom. Skúste stránku obnoviť.',
    screenFailed: { message: 'Túto obrazovku sa nepodarilo načítať.', action: 'Skúsiť znova' },
    notFound: 'Stránka sa nenašla.',
    navigation: 'Hlavná navigácia',
    reload: { message: 'Je dostupná nová verzia administrácie.', action: 'Obnoviť' },
    groups: { content: 'Obsah', users: 'Používatelia', settings: 'Nastavenia' },
    audit: {
      title: 'Auditný záznam',
      description:
        'Najnovšie udalosti sú prvé. Mená aktérov a názvy objektov zodpovedajú času udalosti.',
      timeline: 'Časová os auditu',
      event: 'Udalosť',
      filters: {
        actor: 'Aktér',
        module: 'Modul',
        action: 'Akcia',
        subjectType: 'Typ objektu',
        subjectId: 'ID objektu',
        subjectLabel: 'Názov objektu',
        start: 'Od dátumu (UTC)',
        end: 'Do dátumu vrátane (UTC)',
      },
      filterHelp:
        'Aktér vyhľadáva typ, ID alebo meno. Názov objektu vyhľadáva text. Modul, akcia, typ a ID objektu sa musia presne zhodovať. Oba dátumy zahŕňajú celý deň v UTC.',
      apply: 'Použiť filtre',
      reset: 'Zrušiť filtre',
      invalidRange: 'Zadajte platný rozsah dátumov s koncom v deň začiatku alebo neskôr.',
      invalidThrough: 'Zadajte dátum konca najneskôr 9999-12-30.',
      empty: 'Žiadne auditné udalosti nevyhovujú filtrom.',
      failed: 'Auditné udalosti sa nepodarilo načítať. Skúste to znova.',
      retry: 'Skúsiť znova',
      actors: { user: 'Používateľ', system: 'Systém', anonymous: 'Anonymný' },
      from: 'Z',
      to: 'Na',
      ip: 'IP adresa',
      userAgent: 'Prehliadač',
      previous: 'Predchádzajúce udalosti',
      next: 'Ďalšie udalosti',
      page: 'Strana {page} z {pages}',
      depthLimit:
        'Stránkovať možno len najnovších {count} zhodných udalostí. Staršie udalosti vyhľadajte pomocou filtrov v auditnom zázname.',
    },
  },
  permissions: { 'core.audit.view': 'Zobraziť auditný záznam' },
}

/** Permission keys the shell labels (core's catalog). */
export type ShellPermissionLabels = keyof typeof en.permissions

/** The shell's own catalogs (`admin.*`, core's `permissions.*`); hosts extend or override them. */
export const shellMessages: Readonly<Record<'en' | 'sk', Messages>> = { en, sk }
