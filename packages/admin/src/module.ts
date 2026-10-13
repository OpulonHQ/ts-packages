import type { Component } from 'vue'

/** A lazily imported module (`() => import('./Screen.vue')`). */
export type Lazy<T> = () => Promise<{ readonly default: T }>

/** A message catalog: nested keys to strings. */
export interface Messages {
  readonly [key: string]: string | Messages
}

/** One label per key: `{ 'demo.notes.view': 'View notes' }`. */
export type Labels<Keys extends string> = { readonly [K in Keys]: string }

/**
 * A module's catalog for one admin locale. It must label every permission and audit action the
 * module declares in its `/api` catalogs; the shell serves them as `permissions.<key>` and
 * `audit.<key>`, everything else under the module id (`<id>.<key>`).
 */
export type ModuleMessages<P extends string = never, A extends string = never> = Messages &
  ([P] extends [never] ? unknown : { readonly permissions: Labels<P> }) &
  ([A] extends [never] ? unknown : { readonly audit: Labels<A> })

/**
 * Who may open a route: one permission key, any signed-in staff user, or (only when said
 * explicitly) anyone. The check is UX only; the API enforces access.
 */
export type Access =
  | { readonly permission: string; readonly signedIn?: never; readonly public?: never }
  | { readonly signedIn: true; readonly permission?: never; readonly public?: never }
  | { readonly public: true; readonly permission?: never; readonly signedIn?: never }

export type AdminRoute<Id extends string> = Access & {
  /** `<module id>.<name>`; a host override replaces a route by this name. */
  readonly name: `${Id}.${string}`
  /** Path under `/admin`, e.g. `/demo/notes`. */
  readonly path: `/${string}`
  readonly component: Lazy<Component>
}

/** Built-in nav groups, in this order; hosts add their own through `createAdmin({ navGroups })`. */
export type NavGroup = 'content' | 'users' | 'settings' | (string & {})

export interface NavItem<Id extends string> {
  /** Message key inside the module's namespace, e.g. `nav.notes` for `demo.nav.notes`. */
  readonly label: string
  /** The target route; the item is hidden when the user may not open it. */
  readonly route: `${Id}.${string}`
  /** Lucide icon, e.g. `i-lucide-notebook`. */
  readonly icon?: `i-lucide-${string}`
  /** Omitted: the top group, next to Dashboard. */
  readonly group?: NavGroup
  /** Ascending within the group; default 0, ties keep declaration order. */
  readonly order?: number
}

export interface Widget {
  readonly name: string
  readonly component: Lazy<Component>
  /** Shown only to users holding it. */
  readonly permission?: string
  /** Ascending on the dashboard; default 0. */
  readonly order?: number
}

/** Sign-in routing for the shell. `usersAdmin()` provides the only one (TSPACK-10). */
export interface AuthProvider {
  /** Name of a `public` route of the same module: where signed-out users are sent. */
  readonly signInRoute: string
  /** Ends the session; the shell then shows the sign-in route. */
  readonly signOut?: (api: {
    readonly apiPrefix: string
    readonly fetch: typeof globalThis.fetch
  }) => Promise<void>
  /** Name of a `signedIn` route of the same module: the user's own settings, in the user menu. */
  readonly accountRoute?: string
  /** Saves the user's admin locale (null: the admin default); the shell then reads /me again. */
  readonly setLocale?: (api: {
    readonly apiPrefix: string
    readonly fetch: typeof globalThis.fetch
    readonly userId: string
    readonly locale: string | null
  }) => Promise<void>
}

export interface AdminModule<Id extends string = string> {
  readonly id: Id
  readonly routes: ReadonlyArray<AdminRoute<Id>>
  readonly nav?: ReadonlyArray<NavItem<Id>>
  /** Dashboard widgets. */
  readonly widgets?: ReadonlyArray<Widget>
  /** Lazy catalogs, loaded when the module is enabled and its locale is used. */
  readonly messages: { readonly en: Lazy<Messages>; readonly sk: Lazy<Messages> }
  readonly auth?: AuthProvider
}

/**
 * Describes a module's admin side (package or host module) for `createAdmin`. Pass the
 * module's `/api` catalogs as `permissions` and `auditActions`: then both the en and sk
 * catalogs must label every key, or the module fails to typecheck.
 */
export const defineAdminModule = <
  const Id extends string,
  const P extends string = never,
  const A extends string = never,
>(
  m: Omit<AdminModule<Id>, 'messages'> & {
    readonly permissions?: ReadonlyArray<P>
    readonly auditActions?: ReadonlyArray<{ readonly key: A }>
    readonly messages: {
      readonly en: Lazy<ModuleMessages<NoInfer<P>, NoInfer<A>>>
      readonly sk: Lazy<ModuleMessages<NoInfer<P>, NoInfer<A>>>
    }
  },
): AdminModule<Id> => m
