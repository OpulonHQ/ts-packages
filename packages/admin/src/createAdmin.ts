import 'virtual:opulon-ui.css'
import { Me as MeSchema } from '@opulonjs/core/api'
import { Schema } from 'effect'
import { type Brand, uiPlugin } from '@opulonjs/ui'
import {
  computed,
  createApp,
  defineAsyncComponent,
  isVNode,
  shallowRef,
  type App,
  type FunctionalComponent,
} from 'vue'
import { createI18n } from 'vue-i18n'
import {
  createRouter,
  createWebHistory,
  isNavigationFailure,
  NavigationFailureType,
  type RouteComponent,
  type RouteLocationNormalized,
  type RouteRecordSingleView,
} from 'vue-router'
import { shellMessages } from './messages.ts'
import type { Access, AdminModule, Messages } from './module.ts'
import NotFound from './shell/NotFound.vue'
import Shell from './shell/Shell.vue'
import {
  adminStateKey,
  apiContextKey,
  failedScreenKey,
  type AdminState,
  type Me,
  type ShellNavGroup,
  type Status,
} from './state.ts'

type RouteLoader = () => Promise<RouteComponent | { readonly default: RouteComponent }>

export interface AdminOptions {
  /** The same brand object the host passes to `opulonAdmin({ brand })` in its Vite config. */
  readonly brand: Brand
  readonly modules: ReadonlyArray<AdminModule>
  /** Host components by route name; the route's path, access and navigation stay intact. */
  readonly overrides?: Readonly<Record<string, RouteComponent | RouteLoader>>
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

const isRouteComponent = (component: RouteComponent | RouteLoader): component is RouteComponent =>
  typeof component !== 'function' ||
  'displayName' in component ||
  'props' in component ||
  '__vccOpts' in component

const lazy = (component: RouteLoader) => () =>
  Promise.resolve(component()).then((loaded: unknown): RouteComponent => {
    if (typeof loaded === 'function') return loaded as RouteComponent
    if (loaded && typeof loaded === 'object' && !isVNode(loaded) && !Array.isArray(loaded))
      return 'default' in loaded ? (loaded.default as RouteComponent) : (loaded as RouteComponent)
    return component as FunctionalComponent
  })

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
  const routeNames = new Set([
    'dashboard',
    'core.audit',
    'notFound',
    ...options.modules.flatMap((m) => m.routes.map((r) => r.name)),
  ])
  for (const name of Object.keys(options.overrides ?? {})) {
    if (!routeNames.has(name)) throw new Error(`createAdmin: unknown route override "${name}"`)
  }
  const ids = new Set<string>()
  for (const m of options.modules) {
    for (const route of m.routes) {
      if (/^\/audit\/*$/i.test(route.path) && route.name !== 'core.audit')
        throw new Error(`createAdmin: path "${route.path}" is reserved for route "core.audit"`)
    }
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
  const auditOverride = options.modules.some((m) => m.routes.some((r) => r.name === 'core.audit'))
  const allowed = (access: Access | undefined) =>
    !access || access.public || access.signedIn || can(access.permission)

  let unmounted = false
  let epoch = 0
  const begin = () => {
    const turn = ++epoch
    return () => !unmounted && turn === epoch
  }
  // The latest successful write, applied only when the read after it fails for the same user.
  // Write order only stops an older write's late answer from re-arming it.
  let lastWrite:
    | { readonly userId: string; readonly apply: (live: () => boolean) => Promise<void> | void }
    | undefined
  let writeOrder = 0
  let armedWriteOrder = 0
  const showSignedOut = () => {
    lastWrite = undefined
    me.value = undefined
    status.value = 'signedOut'
  }
  const getMe = async (): Promise<Me | 'signedOut'> => {
    const response = await fetch(new URL(`${apiPrefix}/me`, location.origin), {
      credentials: 'same-origin',
    })
    if (response.status === 401) return 'signedOut'
    if (!response.ok) throw new Error(`${apiPrefix}/me answered ${response.status}`)
    return Schema.decodeUnknownSync(MeSchema)(await response.json())
  }

  const loadMessages = (locale: string, modules: ReadonlyArray<AdminModule>, live: () => boolean) =>
    Promise.all(
      modules.map(async (m) => {
        const load = m.messages[locale as 'en' | 'sk'] ?? m.messages.en
        const { default: messages } = await load()
        if (live()) i18n.global.mergeLocaleMessage(locale, toI18n(messages, m.id))
      }),
    )

  /** Loads the modules' catalogs for a user's locale (en as the fallback) and switches to it. */
  const applyLocale = async (
    requested: string | null,
    modules: ReadonlyArray<AdminModule>,
    live: () => boolean,
  ) => {
    const locale = requested && requested in catalogs ? requested : defaultLocale
    await Promise.all([
      loadMessages(locale, modules, live),
      locale === 'en' ? undefined : loadMessages('en', modules, live),
    ])
    if (!live()) return
    i18n.global.locale.value = locale
    document.documentElement.lang = locale
  }

  // The auth provider's messages are needed before sign-in, too.
  const load = () => {
    const live = begin()
    return getMe().then(
      async (first) => {
        if (first === 'signedOut') {
          await loadMessages(defaultLocale, [auth], live).catch((error: unknown) =>
            console.error(error),
          )
          if (live()) showSignedOut()
          return
        }
        for (const m of options.modules) {
          if (!first.modules.includes(m.id) && import.meta.env.DEV) {
            console.warn(
              `[@opulonjs/admin] admin module "${m.id}" is hidden: the server does not run it (missing from /me).`,
            )
          }
        }
        await applyLocale(
          first.locale,
          options.modules.filter((m) => first.modules.includes(m.id)),
          live,
        )
        if (!live()) return
        lastWrite = undefined
        me.value = first
        status.value = 'ready'
      },
      (error: unknown) => {
        console.error(error)
        if (!live()) return
        if (status.value !== 'ready') status.value = 'failed'
        else if (lastWrite && lastWrite.userId === me.value?.user.id) void lastWrite.apply(live)
      },
    )
  }
  let ready = load()
  const toSignIn = async () => {
    const route = router.currentRoute.value
    if (unmounted || status.value !== 'signedOut' || route.meta.access?.public) return
    if (route.matched.length > 0) await router.push({ name: auth.auth!.signInRoute })
  }
  const read = async () => {
    ready = load()
    await ready
    await toSignIn()
  }
  // A write's own answer may belong to an ended session or be older than another write, so the
  // shell shows what the server holds after it, read fresh.
  const afterWrite = async (
    write: Promise<void>,
    apply: NonNullable<typeof lastWrite>['apply'],
  ) => {
    const userId = me.value?.user.id
    const order = ++writeOrder
    try {
      await write
      if (userId && order > armedWriteOrder) {
        armedWriteOrder = order
        lastWrite = { userId, apply }
      }
    } finally {
      await read()
    }
  }

  const nav = computed<ReadonlyArray<ShellNavGroup>>(() => {
    const routes = new Map<string, Access>([
      ['core.audit', { permission: 'core.audit.view' }],
      ...options.modules.flatMap((m) => m.routes.map((r): [string, Access] => [r.name, r])),
    ])
    const items = [
      ...enabled.value.flatMap((m) =>
        (m.nav ?? []).map((n) => ({ ...n, label: `${m.id}.${n.label}` })),
      ),
      ...(me.value?.modules.includes('core') && !auditOverride
        ? [
            {
              label: 'admin.audit.title',
              route: 'core.audit',
              group: 'settings',
              order: 100,
              icon: 'i-lucide-history',
            },
          ]
        : []),
    ]
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
    refresh: read,
    ...(providerSignOut
      ? {
          signOut: () => afterWrite(providerSignOut({ apiPrefix, fetch }), showSignedOut),
        }
      : {}),
    ...(accountRoute ? { accountRoute } : {}),
    ...(providerSetLocale
      ? {
          setLocale: async (locale: string | null) => {
            const userId = me.value?.user.id
            if (!userId) return
            await afterWrite(
              providerSetLocale({ apiPrefix, fetch, userId, locale }),
              async (live) => {
                await applyLocale(locale, enabled.value, live)
                if (me.value && live()) me.value = { ...me.value, locale }
              },
            )
          },
        }
      : {}),
  }

  const routes: Array<RouteRecordSingleView> = [
    {
      path: '/',
      name: 'dashboard',
      component: lazy(() => import('./shell/Dashboard.vue')),
      meta: { access: { signedIn: true } },
    },
    ...(!auditOverride
      ? [
          {
            path: '/audit',
            name: 'core.audit',
            component: () => import('./audit/AuditScreen.vue'),
            meta: { module: 'core', access: { permission: 'core.audit.view' } },
          },
        ]
      : []),
    ...options.modules.flatMap((m) =>
      m.routes.map((r) => {
        const { name, path, component, ...access } = r
        return {
          path,
          name,
          component: lazy(component),
          meta: { module: m.id, access: access as Access },
        }
      }),
    ),
    { path: '/:rest(.*)*', name: 'notFound', component: NotFound },
  ]
  const router = createRouter({
    history: createWebHistory('/admin/'),
    routes: routes.map((route) => {
      const component = typeof route.name === 'string' ? options.overrides?.[route.name] : undefined
      return component
        ? { ...route, component: isRouteComponent(component) ? component : lazy(component) }
        : route
    }),
  })
  // Leave guards run before beforeEach, so a host leave guard's error stays in the console.
  let latest: RouteLocationNormalized | undefined
  router.beforeEach(async (to) => {
    latest = to
    await ready
    if (unmounted) return true
    const { module, access } = to.meta
    if (access?.public) return true
    if (status.value === 'signedOut') {
      return { name: auth.auth!.signInRoute, query: { redirect: to.fullPath } }
    }
    if (status.value !== 'ready') return true
    if (module && !me.value?.modules.includes(module)) return { name: 'dashboard' }
    // UX only: the API enforces the permission.
    if (!allowed(access)) return { name: 'dashboard' }
    return true
  })
  // Re-check the build after each navigation, so an open tab learns about a deploy.
  let latestCheck = 0
  const checkForNewDeploy = () => {
    const known = me.value
    if (!known || unmounted) return
    const turn = epoch
    const check = ++latestCheck
    getMe().then(
      (next) => {
        if (unmounted || turn !== epoch || check !== latestCheck) return
        // A read already in flight for the same account started after the last write, so it may still apply.
        if (next === 'signedOut' || next.user.id !== known.user.id) epoch++
        if (next === 'signedOut') {
          showSignedOut()
          return toSignIn().catch((error: unknown) => console.warn(error))
        }
        lastWrite = undefined
        me.value = { ...next, modules: known.modules }
      },
      // A failed re-check keeps the last known state; the next navigation retries.
      (error: unknown) => console.warn(error),
    )
  }
  const failedScreen = shallowRef<string>()
  router.onError((error: unknown, to) => {
    console.error(error)
    if (unmounted || to !== latest) return
    failedScreen.value = to.fullPath
    checkForNewDeploy()
  })
  router.afterEach((to, from, failure) => {
    if (unmounted) return
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) latest = to
    if (to === latest) failedScreen.value = undefined
    if (from.matched.length > 0) checkForNewDeploy()
  })

  document.title = options.brand.name
  const app = createApp(Shell)
    .use(router)
    .use(i18n)
    .use(uiPlugin)
    .provide(apiContextKey, { apiPrefix, fetch })
    .provide(adminStateKey, state)
    .provide(failedScreenKey, failedScreen)
  app.onUnmount(() => {
    unmounted = true
    router.options.history.destroy()
  })
  return app
}
