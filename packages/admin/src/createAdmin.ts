import {
  computed,
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  shallowRef,
  type App,
} from 'vue'
import { createI18n, useI18n } from 'vue-i18n'
import { createRouter, createWebHistory, RouterLink, RouterView } from 'vue-router'
import { apiContextKey } from './api-client.ts'
import { shellMessages } from './messages.ts'
import type { AdminModule } from './module.ts'

/** Build-time brand config. Palettes, logo, font and Nuxt UI overrides arrive with TSPACK-26. */
export interface Brand {
  readonly name: string
}

/** What the shell reads from `<apiPrefix>/me`. TSPACK-25 adds user, locale and permissions. */
export interface Me {
  readonly buildId: string
  readonly modules: ReadonlyArray<string>
}

export interface AdminOptions {
  readonly brand: Brand
  readonly modules: ReadonlyArray<AdminModule>
  /** Defaults to what the `opulonAdmin()` Vite preset injected, else `/api`. */
  readonly apiPrefix?: `/${string}`
  /** Defaults to what the `opulonAdmin()` Vite preset injected (the commit SHA). */
  readonly buildId?: string
  /** Defaults to the global fetch; tests route it into the host Worker. */
  readonly fetch?: typeof globalThis.fetch
}

type Locale = keyof typeof shellMessages

const injected = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content

/**
 * The admin SPA, served at `/admin`. Loads `/me`, hides modules the server does not run (with a
 * dev warning), loads enabled modules' messages, and shows a reload notice once the server runs
 * another build. Mount the returned app: `createAdmin({...}).mount('#app')`.
 */
export const createAdmin = (options: AdminOptions): App => {
  const ids = new Set<string>()
  for (const m of options.modules) {
    if (ids.has(m.id)) throw new Error(`createAdmin: duplicate admin module id "${m.id}"`)
    ids.add(m.id)
  }
  const auth = options.modules.filter((m) => m.auth)
  if (auth.length > 1) {
    throw new Error(
      `createAdmin: more than one auth provider (${auth.map((m) => m.id).join(', ')})`,
    )
  }

  const apiPrefix = options.apiPrefix ?? injected('opulon-api-prefix') ?? '/api'
  const buildId = options.buildId ?? injected('opulon-build-id')
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: shellMessages,
  })

  const me = shallowRef<Me>()
  const failed = shallowRef(false)
  const enabled = computed(() => options.modules.filter((m) => me.value?.modules.includes(m.id)))

  const getMe = async (): Promise<Me> => {
    const response = await fetch(new URL(`${apiPrefix}/me`, location.origin), {
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`${apiPrefix}/me answered ${response.status}`)
    return (await response.json()) as Me
  }

  const ready = getMe().then(
    async (first) => {
      const locale = i18n.global.locale.value as Locale
      for (const m of options.modules) {
        if (!first.modules.includes(m.id) && import.meta.env.DEV) {
          console.warn(
            `[@opulonjs/admin] admin module "${m.id}" is hidden: the server does not run it (missing from /me).`,
          )
        }
      }
      await Promise.all(
        options.modules
          .filter((m) => first.modules.includes(m.id))
          .map(async (m) => {
            const { default: messages } = await m.messages[locale]()
            i18n.global.mergeLocaleMessage(locale, { [m.id]: messages })
          }),
      )
      me.value = first
    },
    (error: unknown) => {
      console.error(error)
      failed.value = true
    },
  )

  const NotFound = defineComponent(() => {
    const { t } = useI18n()
    return () => h('p', t('admin.notFound'))
  })

  const widgets = options.modules.flatMap((m) =>
    (m.widgets ?? []).map((w) => ({
      module: m.id,
      key: `${m.id}.${w.name}`,
      component: defineAsyncComponent(w.component),
    })),
  )
  const Dashboard = defineComponent(() => {
    const { t } = useI18n()
    return () =>
      h('section', [
        h('h1', t('admin.dashboard')),
        ...widgets
          .filter((w) => enabled.value.some((m) => m.id === w.module))
          .map((w) => h(w.component, { key: w.key })),
      ])
  })

  const router = createRouter({
    history: createWebHistory('/admin/'),
    routes: [
      { path: '/', name: 'dashboard', component: Dashboard },
      ...options.modules.flatMap((m) =>
        m.routes.map((r) => ({
          path: r.path,
          name: r.name,
          component: r.component,
          meta: { module: m.id },
        })),
      ),
      { path: '/:rest(.*)*', name: 'notFound', component: NotFound },
    ],
  })
  router.beforeEach(async (to) => {
    await ready
    const module = to.meta.module
    if (typeof module === 'string' && !enabled.value.some((m) => m.id === module)) {
      return { name: 'dashboard' }
    }
  })
  // Re-check the build after each navigation, so an open tab learns about a deploy.
  router.afterEach((_to, from) => {
    if (from.matched.length === 0 || !me.value) return
    getMe().then(
      (next) => (me.value = { ...next, modules: me.value?.modules ?? next.modules }),
      // A failed re-check keeps the last known state; the next navigation retries.
      (error: unknown) => console.warn(error),
    )
  })

  const Shell = defineComponent(() => {
    const { t } = useI18n()
    const stale = computed(
      () => buildId !== undefined && me.value !== undefined && me.value.buildId !== buildId,
    )
    const nav = computed(() =>
      enabled.value.flatMap((m) =>
        (m.nav ?? []).map((n) => ({ route: n.route, label: `${m.id}.${n.label}` })),
      ),
    )
    return () =>
      h('div', { class: 'opulon-admin' }, [
        stale.value
          ? h('div', { role: 'alert' }, [
              t('admin.reload.message'),
              ' ',
              h(
                'button',
                { type: 'button', onClick: () => location.reload() },
                t('admin.reload.action'),
              ),
            ])
          : null,
        h('header', [h(RouterLink, { to: { name: 'dashboard' } }, () => options.brand.name)]),
        me.value
          ? h(
              'nav',
              { 'aria-label': t('admin.navigation') },
              h(
                'ul',
                nav.value.map((n) =>
                  h('li', { key: n.route }, [
                    h(RouterLink, { to: { name: n.route } }, () => t(n.label)),
                  ]),
                ),
              ),
            )
          : null,
        h(
          'main',
          failed.value
            ? h('p', { role: 'alert' }, t('admin.meFailed'))
            : me.value
              ? h(RouterView)
              : h('p', t('admin.loading')),
        ),
      ])
  })

  return createApp(Shell).use(router).use(i18n).provide(apiContextKey, { apiPrefix, fetch })
}
