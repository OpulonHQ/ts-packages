import type { Brand } from '@opulonjs/ui'
import type { Me } from '@opulonjs/core/api'
import {
  inject,
  onBeforeUnmount,
  watchEffect,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type ShallowRef,
} from 'vue'

export type { Me } from '@opulonjs/core/api'

export interface ApiContext {
  readonly apiPrefix: string
  readonly fetch: typeof globalThis.fetch
}

export const apiContextKey: InjectionKey<ApiContext> = Symbol('@opulonjs/admin/api')

export type Status = 'loading' | 'ready' | 'signedOut' | 'failed'

/** A nav entry the user may open: label key (already namespaced), route name, icon. */
export interface ShellNavItem {
  readonly label: string
  readonly route: string
  readonly icon?: string
  /** Entries under it (a namespaced key or a name per admin locale), opening `route` with params. */
  readonly children?: ReadonlyArray<{
    readonly label: string | Readonly<Record<string, string>>
    readonly params: Readonly<Record<string, string>>
  }>
}

/** What a screen shows, in nav terms: the route of its nav entry and, under it, its params. */
export interface NavTarget {
  readonly route: string
  readonly params?: Readonly<Record<string, string>>
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
  /** The nav entry the current screen names (`useNavTarget`); else the route's own or `nav`. */
  readonly navTarget: ShallowRef<NavTarget | undefined>
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
  /** Saves the user's admin locale through `save` (e.g. a module's own API), then shows what the server holds. */
  readonly saveLocale: (
    locale: string | null,
    save: (userId: string) => Promise<void>,
  ) => Promise<void>
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

/**
 * Names the sidebar entry a screen belongs to when its route cannot: an item editor opens by id,
 * but its collection's entry should stay highlighted. Follows `target` while the screen lives.
 *
 * useNavTarget(() => item.value && { route: 'cms.collections', params: { collection: item.value.collection } })
 */
export const useNavTarget = (target: () => NavTarget | undefined): void => {
  const { navTarget } = useAdmin()
  let own: NavTarget | undefined
  watchEffect(() => {
    own = target()
    navTarget.value = own
  })
  onBeforeUnmount(() => {
    if (navTarget.value === own) navTarget.value = undefined
  })
}
