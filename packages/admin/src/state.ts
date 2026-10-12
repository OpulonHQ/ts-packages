import type { Brand } from '@opulonjs/ui'
import { inject, type Component, type ComputedRef, type InjectionKey, type ShallowRef } from 'vue'

/**
 * What the shell reads from `<apiPrefix>/me` (staff-only; mirrors `Me` in @opulonjs/core/api,
 * which the admin may not import).
 */
export interface Me {
  readonly buildId: string
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
  /** The user's admin locale; null means the admin default. */
  readonly locale: string | null
  readonly permissions: ReadonlyArray<string>
  readonly modules: ReadonlyArray<string>
  readonly permissionCatalog: ReadonlyArray<string>
  /** The host's content locales, first = default (for localized fields, e.g. `LocaleTabs`). */
  readonly contentLocales: ReadonlyArray<string>
}

export type Status = 'loading' | 'ready' | 'signedOut' | 'failed'

/** A nav entry the user may open: label key (already namespaced), route name, icon. */
export interface ShellNavItem {
  readonly label: string
  readonly route: string
  readonly icon?: string
}

export interface ShellNavGroup {
  /** Undefined for the top group. */
  readonly id?: string
  readonly items: ReadonlyArray<ShellNavItem>
}

export interface ShellWidget {
  readonly key: string
  readonly component: Component
}

export interface AdminState {
  readonly brand: Brand
  readonly me: ShallowRef<Me | undefined>
  readonly status: ShallowRef<Status>
  /** The server runs another build than this admin: ask for a reload. */
  readonly stale: ComputedRef<boolean>
  readonly nav: ComputedRef<ReadonlyArray<ShellNavGroup>>
  readonly widgets: ComputedRef<ReadonlyArray<ShellWidget>>
  /** Whether the signed-in user holds a permission (UX only; the API enforces it). */
  readonly can: (permission: string) => boolean
}

export const adminStateKey: InjectionKey<AdminState> = Symbol('@opulonjs/admin/state')

/** The shell's state for module screens: the signed-in user (`me`) and `can(permission)`. */
export const useAdmin = (): AdminState => {
  const state = inject(adminStateKey)
  if (!state) throw new Error('useAdmin must be called inside a createAdmin app')
  return state
}
