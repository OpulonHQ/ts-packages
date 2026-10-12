import type { Component } from 'vue'

/** A lazily imported module (`() => import('./Screen.vue')`). */
export type Lazy<T> = () => Promise<{ readonly default: T }>

/** A message catalog: nested keys to strings. */
export interface Messages {
  readonly [key: string]: string | Messages
}

/**
 * Who may open a route: one permission key, any signed-in staff user, or (only when said
 * explicitly) anyone.
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

export interface NavItem<Id extends string> {
  /** Message key inside the module's namespace, e.g. `nav.notes` for `demo.nav.notes`. */
  readonly label: string
  readonly route: `${Id}.${string}`
  /** Nav group (Content, Users, Settings or a host group); the shell groups by it later. */
  readonly group?: string
}

export interface Widget {
  readonly name: string
  readonly component: Lazy<Component>
  readonly permission?: string
}

/** Sign-in routing for the shell. `usersAdmin()` provides the only one (TSPACK-10). */
export interface AuthProvider {
  /** Route name of the sign-in screen. */
  readonly signInRoute: string
}

export interface AdminModule<Id extends string = string> {
  readonly id: Id
  readonly routes: ReadonlyArray<AdminRoute<Id>>
  readonly nav?: ReadonlyArray<NavItem<Id>>
  /** Dashboard widgets. */
  readonly widgets?: ReadonlyArray<Widget>
  /** Lazy catalogs, merged under the module id (`<id>.<key>`) when the module is enabled. */
  readonly messages: { readonly en: Lazy<Messages>; readonly sk: Lazy<Messages> }
  readonly auth?: AuthProvider
}

/** Describes a module's admin side (package or host module) for `createAdmin`. */
export const defineAdminModule = <const Id extends string>(m: AdminModule<Id>): AdminModule<Id> => m
