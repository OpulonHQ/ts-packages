import type { Brand } from '@opulonjs/ui'
import type { Me } from '@opulonjs/core/api'
import { inject, type Component, type ComputedRef, type InjectionKey, type ShallowRef } from 'vue'

export type { Me } from '@opulonjs/core/api'

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
  /** Reads `/me` again, e.g. after the auth provider signed the user in. */
  readonly refresh: () => Promise<void>
  /** Signs out through the auth provider, when it supports it. */
  readonly signOut?: () => Promise<void>
  /** The auth provider's account route, for the user menu. */
  readonly accountRoute?: string
  /** Saves and applies the user's admin locale, when the auth provider supports it. */
  readonly setLocale?: (locale: string | null) => Promise<void>
}

export const adminStateKey: InjectionKey<AdminState> = Symbol('@opulonjs/admin/state')

export const failedScreenKey: InjectionKey<ShallowRef<string | undefined>> = Symbol(
  '@opulonjs/admin/failed-screen',
)

/** The shell's state for module screens: the signed-in user (`me`) and `can(permission)`. */
export const useAdmin = (): AdminState => {
  const state = inject(adminStateKey)
  if (!state) throw new Error('useAdmin must be called inside a createAdmin app')
  return state
}
