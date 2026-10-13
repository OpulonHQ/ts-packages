import { createAdmin, type AdminOptions } from '../src/createAdmin.ts'
import { defineAdminModule } from '../src/module.ts'
import { defineComponent, h } from 'vue'
import { useRoute } from 'vue-router'
import { expect, onTestFinished, test, vi } from 'vitest'

const screen = (text: string) => defineComponent(() => () => h('p', text))
const lazy = (text: string) => async () => ({ default: screen(text) })
const messages = {
  en: async () => ({ default: { nav: { protected: 'Protected screen' } } }),
  sk: async () => ({ default: {} }),
}
const auth = defineAdminModule({
  id: 'auth',
  auth: { signInRoute: 'auth.signIn' },
  routes: [{ name: 'auth.signIn', path: '/sign-in', public: true, component: lazy('sign in') }],
  messages,
})
const demo = defineAdminModule({
  id: 'demo',
  routes: [
    {
      name: 'demo.protected',
      path: '/protected',
      permission: 'demo.view',
      component: lazy('original screen'),
    },
  ],
  nav: [{ label: 'nav.protected', route: 'demo.protected', group: 'content' }],
  messages,
})

test.each([false, true])(
  'renders a lazy override returning a component or module: %s',
  async (module) => {
    mount('/protected', {
      overrides: {
        'demo.protected': async () =>
          module ? { default: screen('lazy host screen') } : screen('lazy host screen'),
      },
    })
    await expect.poll(() => document.body.textContent).toContain('lazy host screen')
    expect(document.body.textContent).not.toContain('original screen')
  },
)

test.each([
  ['a VNode', () => h('p', 'functional host screen')],
  ['VNodes', () => [h('p', 'functional host screen')]],
  ['text', () => 'functional host screen'],
])('renders a plain functional route override returning %s', async (_, dashboard) => {
  mount('/', { overrides: { dashboard } })
  await expect.poll(() => document.body.textContent).toContain('functional host screen')
})

function mount(
  path: string,
  options: Partial<AdminOptions> = {},
  session = { permissions: ['demo.view', 'core.audit.view'], modules: ['auth', 'demo', 'core'] },
) {
  history.replaceState(null, '', `/admin${path}`)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({
    brand: { name: 'Override test' },
    modules: [auth, demo],
    fetch: async () =>
      Response.json({
        ...session,
        buildId: 'test',
        user: { id: 'staff', name: 'Staff', email: 'staff@example.com' },
        locale: 'en',
        permissionCatalog: ['demo.view', 'core.audit.view'],
        contentLocales: ['en'],
      }),
    ...options,
  })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return app
}

test('rejects unknown route overrides before fetching or starting the app', () => {
  let requested = false
  expect(() =>
    createAdmin({
      brand: { name: 'Test' },
      modules: [auth, demo],
      overrides: { 'demo.typo': screen('typo') },
      fetch: async () => {
        requested = true
        throw new Error('must not fetch')
      },
    }),
  ).toThrow(/unknown.*demo\.typo/i)
  expect(requested).toBe(false)
})

test('replaces a module component while preserving its path, metadata and navigation', async () => {
  const replacement = defineComponent(() => {
    const route = useRoute()
    return () => h('p', `host screen ${route.name?.toString()} ${route.meta.module}`)
  })
  mount('/protected', { overrides: { 'demo.protected': replacement } })
  await expect.poll(() => document.body.textContent).toContain('host screen demo.protected demo')
  expect(document.body.textContent).not.toContain('original screen')
  expect(document.querySelector('nav')?.textContent).toContain('Protected screen')
  expect(location.pathname).toBe('/admin/protected')
})

test.each([
  { permissions: [], modules: ['auth', 'demo', 'core'] },
  { permissions: ['demo.view'], modules: ['auth', 'core'] },
])('component overrides retain access and module checks: %j', async (session) => {
  mount(
    '/protected',
    { overrides: { 'demo.protected': screen('host protected'), dashboard: screen('host home') } },
    session,
  )
  await expect.poll(() => document.body.textContent).toContain('host home')
  expect(document.body.textContent).not.toContain('host protected')
  expect(document.querySelector('nav')?.textContent).not.toContain('Protected screen')
  expect(location.pathname).toBe('/admin/')
})

test.each([
  ['/', 'dashboard'],
  ['/audit', 'core.audit'],
  ['/missing', 'notFound'],
] as const)('replaces builtin route %s by name %s', async (path, name) => {
  mount(path, { overrides: { [name]: screen(`host ${name}`) } })
  await expect.poll(() => document.body.textContent).toContain(`host ${name}`)
  if (name === 'core.audit') expect(document.querySelector('nav')?.textContent).toContain('Audit')
})

test('replaces the component of an existing module audit replacement without restoring /audit', async () => {
  const core = defineAdminModule({
    id: 'core',
    routes: [
      {
        name: 'core.audit',
        path: '/custom-audit',
        permission: 'core.audit.view',
        component: lazy('module audit'),
      },
    ],
    nav: [{ label: 'nav.protected', route: 'core.audit', group: 'settings' }],
    messages,
  })
  mount('/custom-audit', {
    modules: [auth, demo, core],
    overrides: { 'core.audit': screen('host audit') },
  })
  await expect.poll(() => document.body.textContent).toContain('host audit')
  expect(document.querySelector('nav a[href="/admin/custom-audit"]')).not.toBeNull()
  expect(document.querySelector('nav a[href="/admin/audit"]')).toBeNull()
})

test.each(['/audit', '/AUDIT/', '/audit///'] as const)(
  'retains the audit path reservation: %s',
  (path) => {
    const conflict = defineAdminModule({
      id: 'conflict',
      routes: [{ name: 'conflict.home', path, signedIn: true, component: lazy('conflict') }],
      messages,
    })
    expect(() =>
      createAdmin({
        brand: { name: 'Test' },
        modules: [auth, conflict],
        overrides: { 'conflict.home': screen('host') },
      }),
    ).toThrow(/reserved.*core\.audit/)
  },
)

test('a rejected route loader shows an error whose retry reloads the failed screen', async () => {
  const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
  onTestFinished(() => assign.mockRestore())
  const app = mount('/', {
    overrides: { 'demo.protected': () => Promise.reject(new Error('screen download failed')) },
  })
  const router = app.config.globalProperties.$router
  await expect.poll(() => document.body.textContent).toContain('Nothing to show here yet.')
  await expect(router.push('/protected?tab=1')).rejects.toThrow('screen download failed')
  await expect
    .poll(() => document.querySelector('[role="alert"]')?.textContent)
    .toContain('This screen could not be loaded.')
  const retry = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Try again'),
  )
  retry?.click()
  expect(assign).toHaveBeenCalledWith('/admin/protected?tab=1')
})

test('returning to the current screen clears a failed screen error', async () => {
  const app = mount('/', {
    overrides: { 'demo.protected': () => Promise.reject(new Error('screen download failed')) },
  })
  const router = app.config.globalProperties.$router
  await expect.poll(() => document.body.textContent).toContain('Nothing to show here yet.')
  await expect(router.push('/protected')).rejects.toThrow('screen download failed')
  await expect.poll(() => document.querySelector('[role="alert"]')).not.toBeNull()
  await router.push('/')
  await expect.poll(() => document.querySelector('[role="alert"]')).toBeNull()
  expect(document.body.textContent).toContain('Nothing to show here yet.')
})

test('a failed navigation keeps the current screen usable', async () => {
  const app = mount('/', {
    overrides: { 'demo.protected': () => Promise.reject(new Error('screen download failed')) },
  })
  const router = app.config.globalProperties.$router
  await expect.poll(() => document.body.textContent).toContain('Nothing to show here yet.')
  await expect(router.push('/protected')).rejects.toThrow('screen download failed')
  await expect.poll(() => document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.body.textContent).toContain('Nothing to show here yet.')
})

test('a failed route load re-checks the build and asks for a reload', async () => {
  let deployed = 'test'
  const app = mount('/', {
    buildId: 'test',
    overrides: { 'demo.protected': () => Promise.reject(new Error('chunk deleted by deploy')) },
    fetch: async () =>
      Response.json({
        permissions: ['demo.view'],
        modules: ['auth', 'demo', 'core'],
        buildId: deployed,
        user: { id: 'staff', name: 'Staff', email: 'staff@example.com' },
        locale: 'en',
        permissionCatalog: ['demo.view'],
        contentLocales: ['en'],
      }),
  })
  const router = app.config.globalProperties.$router
  await expect.poll(() => document.body.textContent).toContain('Nothing to show here yet.')
  deployed = 'next'
  await expect(router.push('/protected')).rejects.toThrow('chunk deleted by deploy')
  await expect.poll(() => document.body.textContent).toContain('A new admin version is available.')
})

const sleep = (ms = 75) => new Promise((done) => setTimeout(done, ms))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('a late chunk rejection cannot hide a newer screen', async () => {
  const old = deferred<ReturnType<typeof screen>>()
  let started = false
  const app = mount('/', {
    overrides: {
      dashboard: () => {
        started = true
        return old.promise
      },
      'demo.protected': screen('current good screen'),
    },
  })
  const router = app.config.globalProperties.$router
  await expect.poll(() => started).toBe(true)
  await router.push('/protected')
  await expect.poll(() => document.body.textContent).toContain('current good screen')
  old.reject(new Error('old dashboard chunk failed'))
  await sleep()
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.body.textContent).toContain('current good screen')
})

test('a late guard rejection cannot hide a newer screen', async () => {
  const old = deferred<void>()
  const app = mount('/', { overrides: { 'demo.protected': screen('guard target') } })
  const router = app.config.globalProperties.$router
  await router.isReady()
  let started = false
  router.beforeEach(async (to) => {
    if (to.path === '/protected') {
      started = true
      await old.promise
    }
  })
  const navigation = router.push('/protected').catch((error: unknown) => error)
  await expect.poll(() => started).toBe(true)
  await router.push('/sign-in')
  old.reject(new Error('old guard failed'))
  await navigation
  await sleep()
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.body.textContent).toContain('sign in')
})

test.each(['abort', 'redirect'])('an %s guard is not a screen failure', async (kind) => {
  const app = mount('/', { overrides: { 'demo.protected': screen('protected good') } })
  const router = app.config.globalProperties.$router
  await router.isReady()
  router.beforeEach((to) =>
    to.path === '/protected' ? (kind === 'abort' ? false : '/sign-in') : true,
  )
  await router.push('/protected')
  await sleep()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
