import { createAdmin, type AdminOptions } from '../src/createAdmin.ts'
import { defineAdminModule } from '../src/module.ts'
import { defineComponent, h } from 'vue'
import { useRoute } from 'vue-router'
import { expect, onTestFinished, test } from 'vitest'

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

test('renders a plain functional route override', async () => {
  mount('/', { overrides: { dashboard: () => h('p', 'functional host screen') } })
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
