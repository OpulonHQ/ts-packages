import 'virtual:opulon-ui.css'
import { type Brand, uiPlugin } from '@opulonjs/ui'
import { computed, createApp, defineAsyncComponent, shallowRef, type App } from 'vue'
import { createI18n } from 'vue-i18n'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { apiContextKey } from './api-client.ts'
import { shellMessages } from './messages.ts'
import type { Access, AdminModule, Messages } from './module.ts'
import Dashboard from './shell/Dashboard.vue'
import NotFound from './shell/NotFound.vue'
import Shell from './shell/Shell.vue'
import {
  adminStateKey,
  type AdminState,
  type Me,
  type ShellNavGroup,
  type Status,
} from './state.ts'

export interface AdminOptions {
  /** The same brand object the host passes to `opulonAdmin({ brand })` in its Vite config. */
  readonly brand: Brand
  readonly modules: ReadonlyArray<AdminModule>
  /** Host messages by admin locale, merged over the shell's; a new locale key adds a locale. */
  readonly messages?: Readonly<Record<string, Messages>>
  /** Host nav groups (`admin.groups.<id>` labels) by order; built-ins are 100, 200, 300. */
  readonly navGroups?: Readonly<Record<string, number>>
  /** For users without an admin locale. Default `en`. */
  readonly defaultLocale?: string
  /** Defaults to what the `opulonAdmin()` Vite preset injected, else `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Defaults to what the `opulonAdmin()` Vite preset injected (the commit SHA). */
  readonly buildId?: string
  /** Defaults to the global fetch; the host can add credentials, tests route it into the Worker. */
  readonly fetch?: typeof globalThis.fetch
}

declare module 'vue-router' {
  interface RouteMeta {
    module?: string
    access?: Access
  }
}

const builtInGroups: Readonly<Record<string, number>> = { content: 100, users: 200, settings: 300 }

const injected = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content

/**
 * vue-i18n messages from a catalog: `permissions` and `audit` labels become root keys
 * (`permissions.demo.notes.view`, since permission keys contain dots), the rest goes under
 * `namespace` when given.
 */
const toI18n = (catalog: Messages, namespace?: string): Messages => {
  const { permissions, audit, ...rest } = catalog
  const labels = Object.fromEntries(
    Object.entries({ permissions, audit }).flatMap(([kind, entries]) =>
      typeof entries === 'object'
        ? Object.entries(entries).map(([key, label]) => [`${kind}.${key}`, label])
        : [],
    ),
  )
  return { ...labels, ...(namespace ? { [namespace]: rest } : rest) }
}

/**
 * The admin SPA, served at `/admin`: Nuxt UI dashboard layout, nav groups and dashboard
 * widgets filtered by the user's permissions, sign-in routing through the one auth provider,
 * the user's admin locale, and a reload notice once the server runs another build. Modules the
 * server does not run (missing from `/me`) are hidden, with a dev warning.
 * Mount the returned app: `createAdmin({...}).mount('#app')`.
 */
export const createAdmin = (options: AdminOptions): App => {
  const ids = new Set<string>()
  for (const m of options.modules) {
    if (ids.has(m.id)) throw new Error(`createAdmin: duplicate admin module id "${m.id}"`)
    ids.add(m.id)
  }
  const providers = options.modules.filter((m) => m.auth)
  if (providers.length !== 1) {
    throw new Error(
      `createAdmin: exactly one auth provider required, found ${providers.length}` +
        (providers.length ? ` (${providers.map((m) => m.id).join(', ')})` : ''),
    )
  }
  const auth = providers[0]!
  const signIn = auth.routes.find((r) => r.name === auth.auth?.signInRoute)
  if (!signIn?.public) {
    throw new Error(
      `createAdmin: sign-in route "${auth.auth?.signInRoute}" must be a public route of "${auth.id}"`,
    )
  }

  const apiPrefix = options.apiPrefix ?? injected('opulon-api-prefix') ?? '/api'
  const buildId = options.buildId ?? injected('opulon-build-id')
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const groups = { ...builtInGroups, ...options.navGroups }

  const catalogs: Record<string, Messages> = Object.fromEntries(
    Object.entries(shellMessages).map(([locale, m]) => [locale, toI18n(m)]),
  )
  for (const [locale, m] of Object.entries(options.messages ?? {})) {
    catalogs[locale] = { ...catalogs[locale], ...toI18n(m) }
  }
  const defaultLocale = options.defaultLocale ?? 'en'
  const i18n = createI18n({
    legacy: false,
    locale: defaultLocale,
    fallbackLocale: 'en',
    messages: catalogs,
  })

  const me = shallowRef<Me>()
  const status = shallowRef<Status>('loading')
  const enabled = computed(() => options.modules.filter((m) => me.value?.modules.includes(m.id)))
  const can = (permission: string) => me.value?.permissions.includes(permission) ?? false
  const allowed = (access: Access | undefined) =>
    !access || access.public || access.signedIn || can(access.permission)

  const getMe = async (): Promise<Me | 'signedOut'> => {
    const response = await fetch(new URL(`${apiPrefix}/me`, location.origin), {
      credentials: 'same-origin',
    })
    if (response.status === 401) return 'signedOut'
    if (!response.ok) throw new Error(`${apiPrefix}/me answered ${response.status}`)
    return (await response.json()) as Me
  }

  const loadMessages = (locale: string, modules: ReadonlyArray<AdminModule>) =>
    Promise.all(
      modules.map(async (m) => {
        const load = m.messages[locale as 'en' | 'sk'] ?? m.messages.en
        const { default: messages } = await load()
        i18n.global.mergeLocaleMessage(locale, toI18n(messages, m.id))
      }),
    )

  // The auth provider's messages are needed before sign-in, too.
  const load = () =>
    getMe().then(
      async (first) => {
        if (first === 'signedOut') {
          await loadMessages(defaultLocale, [auth])
          status.value = 'signedOut'
          return
        }
        for (const m of options.modules) {
          if (!first.modules.includes(m.id) && import.meta.env.DEV) {
            console.warn(
              `[@opulonjs/admin] admin module "${m.id}" is hidden: the server does not run it (missing from /me).`,
            )
          }
        }
        const locale = first.locale && first.locale in catalogs ? first.locale : defaultLocale
        const modules = options.modules.filter((m) => first.modules.includes(m.id))
        await Promise.all([
          loadMessages(locale, modules),
          locale === 'en' ? undefined : loadMessages('en', modules),
        ])
        i18n.global.locale.value = locale
        document.documentElement.lang = locale
        me.value = first
        status.value = 'ready'
      },
      (error: unknown) => {
        console.error(error)
        status.value = 'failed'
      },
    )
  let ready = load()

  const nav = computed<ReadonlyArray<ShellNavGroup>>(() => {
    const routes = new Map(options.modules.flatMap((m) => m.routes.map((r) => [r.name, r])))
    const items = enabled.value
      .flatMap((m) => (m.nav ?? []).map((n) => ({ ...n, label: `${m.id}.${n.label}` })))
      .filter((n) => allowed(routes.get(n.route)))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const ids = [...new Set(items.map((n) => n.group))].sort(
      (a, b) => (a ? (groups[a] ?? 1000) : 0) - (b ? (groups[b] ?? 1000) : 0),
    )
    return ids.map((id) => ({
      ...(id ? { id } : {}),
      items: items
        .filter((n) => n.group === id)
        .map((n) => ({ label: n.label, route: n.route, ...(n.icon ? { icon: n.icon } : {}) })),
    }))
  })

  const allWidgets = options.modules.flatMap((m) =>
    (m.widgets ?? []).map((w) => ({
      module: m.id,
      key: `${m.id}.${w.name}`,
      permission: w.permission,
      order: w.order ?? 0,
      component: defineAsyncComponent(() => w.component().then((m) => m.default)),
    })),
  )
  const widgets = computed(() =>
    allWidgets
      .filter((w) => enabled.value.some((m) => m.id === w.module))
      .filter((w) => w.permission === undefined || can(w.permission))
      .sort((a, b) => a.order - b.order)
      .map(({ key, component }) => ({ key, component })),
  )

  const providerSignOut = auth.auth?.signOut
  const providerSetLocale = auth.auth?.setLocale
  const accountRoute = auth.auth?.accountRoute
  const state: AdminState = {
    brand: options.brand,
    me,
    status,
    stale: computed(
      () => buildId !== undefined && me.value !== undefined && me.value.buildId !== buildId,
    ),
    nav,
    widgets,
    can,
    refresh: () => (ready = load()),
    ...(providerSignOut
      ? {
          signOut: async () => {
            await providerSignOut({ apiPrefix, fetch })
            me.value = undefined
            status.value = 'signedOut'
            await router.push({ name: auth.auth!.signInRoute })
          },
        }
      : {}),
    ...(accountRoute ? { accountRoute } : {}),
    ...(providerSetLocale
      ? {
          setLocale: async (locale: string | null) => {
            const userId = me.value?.user.id
            if (!userId) return
            await providerSetLocale({ apiPrefix, fetch, userId, locale })
            await state.refresh()
          },
        }
      : {}),
  }

  const routes: Array<RouteRecordRaw> = [
    { path: '/', name: 'dashboard', component: Dashboard, meta: { access: { signedIn: true } } },
    ...options.modules.flatMap((m) =>
      m.routes.map((r) => {
        const { name, path, component, ...access } = r
        // Lazy modules may be plain `{ default }` objects, which neither Vue nor the router unwrap.
        const lazy = () => component().then((loaded) => loaded.default)
        return { path, name, component: lazy, meta: { module: m.id, access: access as Access } }
      }),
    ),
    { path: '/:rest(.*)*', name: 'notFound', component: NotFound },
  ]
  const router = createRouter({ history: createWebHistory('/admin/'), routes })
  router.beforeEach(async (to) => {
    await ready
    const { module, access } = to.meta
    if (access?.public) return true
    if (status.value === 'signedOut') {
      return { name: auth.auth!.signInRoute, query: { redirect: to.fullPath } }
    }
    if (status.value !== 'ready') return true
    if (module && !enabled.value.some((m) => m.id === module)) return { name: 'dashboard' }
    // UX only: the API enforces the permission.
    if (!allowed(access)) return { name: 'dashboard' }
    return true
  })
  // Re-check the build after each navigation, so an open tab learns about a deploy.
  router.afterEach((_to, from) => {
    if (from.matched.length === 0 || !me.value) return
    getMe().then(
      (next) => {
        if (next !== 'signedOut') me.value = { ...next, modules: me.value?.modules ?? next.modules }
      },
      // A failed re-check keeps the last known state; the next navigation retries.
      (error: unknown) => console.warn(error),
    )
  })

  document.title = options.brand.name
  return createApp(Shell)
    .use(router)
    .use(i18n)
    .use(uiPlugin)
    .provide(apiContextKey, { apiPrefix, fetch })
    .provide(adminStateKey, state)
}
