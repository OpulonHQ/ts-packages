import {
  type AdminOptions,
  type AdminState,
  createAdmin,
  defineAdminModule,
  useAdmin,
} from '@opulonjs/admin'
import { defineComponent, h } from 'vue'
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeHost, seedUser } from './support/users.ts'

// Runs in the `admin` vitest project: happy-dom, built by the opulonAdmin() preset.
const db = useTestDatabase()

const screen = (text: string) => async () => ({
  default: defineComponent(() => () => h('p', text)),
})

// An admin module whose server module is not composed: /me does not list it.
const ghost = defineAdminModule({
  id: 'ghost',
  routes: [
    { name: 'ghost.home', path: '/ghost', signedIn: true, component: screen('ghost screen') },
  ],
  nav: [{ label: 'nav.home', route: 'ghost.home' }],
  messages: {
    en: async () => ({ default: { nav: { home: 'Ghost' } } }),
    sk: async () => ({ default: { nav: { home: 'Duch' } } }),
  },
})

// Admin screens for core (composed on the server): one needs a permission the user lacks.
const coreScreens = defineAdminModule({
  id: 'core',
  routes: [
    {
      name: 'core.audit',
      path: '/core/audit',
      permission: 'core.audit.view',
      component: screen('audit screen'),
    },
    { name: 'core.profile', path: '/core/profile', signedIn: true, component: screen('profile') },
  ],
  nav: [
    { label: 'nav.audit', route: 'core.audit', group: 'settings' },
    { label: 'nav.profile', route: 'core.profile', group: 'settings' },
  ],
  widgets: [
    { name: 'audit', permission: 'core.audit.view', component: screen('audit widget') },
    { name: 'hello', component: screen('hello widget') },
  ],
  messages: {
    en: async () => ({ default: { nav: { audit: 'Audit log', profile: 'Profile' } } }),
    sk: async () => ({ default: { nav: { audit: 'Auditný záznam', profile: 'Profil' } } }),
  },
})

// The admin's fetch, routed into the fixture host's Worker (no mocked API), as a browser.
const hosts = {
  b1: makeHost(() => db.url, { buildId: 'b1' }),
  'new-build': makeHost(() => db.url, { buildId: 'new-build' }),
}
let cookie = ''
beforeAll(async () => {
  const user = await seedUser(db.url, {
    name: 'Demo User',
    locale: 'sk',
    permissions: ['demo.notes.view', 'emails.log.view'],
  })
  cookie = await hosts.b1.signIn(user.email, user.password)
})

function mountAdmin(
  path: string,
  {
    admin = 'b1',
    server = 'b1' as keyof typeof hosts,
    signedIn = true,
    as = undefined as string | undefined,
    wrapFetch = (f: typeof fetch) => f,
  } = {},
) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({
    brand,
    modules: [...adminModules, coreScreens, ghost],
    buildId: admin,
    fetch: wrapFetch(hosts[server].browserFetch({ cookie: signedIn ? (as ?? cookie) : '' })),
  })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return { text: () => document.body.textContent ?? '' }
}

const navText = () => document.querySelector('nav')?.textContent ?? ''

test.each(['/audit', '/audit/', '/AUDIT'] as const)(
  'a module cannot silently shadow audit URL %s under another route name',
  (path) => {
    const conflicting = defineAdminModule({
      id: 'conflicting',
      routes: [{ name: 'conflicting.home', path, signedIn: true, component: screen('conflict') }],
      messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
    })
    expect(() => createAdmin({ brand, modules: [...adminModules, conflicting] })).toThrow(
      /\/audit.*core\.audit/i,
    )
  },
)

test('renders a module route in the user admin locale (sk) with notes from its own API group', async () => {
  const admin = mountAdmin('/admin/demo/notes')
  await expect.poll(admin.text).toContain('hello from demo')
  expect(admin.text()).toContain('Fixture host')
  expect(admin.text()).toContain('Poznámky uložené demo modulom.')
  expect(document.documentElement.lang).toBe('sk')
})

test('groups the nav and shows only items and widgets the user may open', async () => {
  const admin = mountAdmin('/admin/')
  await expect.poll(admin.text).toContain('hello widget')
  // Dashboard first, then Content (demo), then Settings (core).
  expect(navText()).toMatch(/Prehľad.*Obsah.*Poznámky.*Nastavenia.*Profil/)
  expect(navText()).not.toContain('Auditný záznam')
  expect(admin.text()).not.toContain('audit widget')
})

test('a route needing a permission the user lacks falls back to the dashboard', async () => {
  const admin = mountAdmin('/admin/core/audit')
  await expect.poll(admin.text).toContain('hello widget')
  expect(admin.text()).not.toContain('audit screen')
  expect(location.pathname).toBe('/admin/')
})

test('an authorized user reaches the host audit override with one navigation entry', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const session = await hosts.b1.signIn(user.email, user.password)
  const admin = mountAdmin('/admin/core/audit', { as: session })
  await expect.poll(admin.text).toContain('audit screen')
  const links = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].filter(
    (link) => link.textContent?.trim() === 'Audit log',
  )
  expect(links).toHaveLength(1)
  expect(links[0]?.getAttribute('href')).toBe('/admin/core/audit')
  expect(document.querySelector('a[href="/admin/audit"]')).toBeNull()
})

test('the host audit override suppresses the built-in audit URL', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const session = await hosts.b1.signIn(user.email, user.password)
  const admin = mountAdmin('/admin/audit', { as: session })
  await expect.poll(admin.text).toContain('Page not found.')
  expect(admin.text()).not.toContain('Newest events first.')
  expect(admin.text()).not.toContain('audit screen')
})

test('hides admin modules missing from /me, with a dev warning', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => warn.mockRestore())
  const admin = mountAdmin('/admin/ghost')
  await expect.poll(admin.text).toContain('hello widget')
  expect(navText()).not.toContain('Duch')
  expect(admin.text()).not.toContain('ghost screen')
  expect(location.pathname).toBe('/admin/')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ghost"'))
})

test('sends signed-out users to the auth provider sign-in route', async () => {
  const admin = mountAdmin('/admin/demo/notes', { signedIn: false })
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
  expect(new URLSearchParams(location.search).get('redirect')).toBe('/demo/notes')
  await expect.poll(admin.text).toContain('Password')
  expect(admin.text()).not.toContain('Poznámky')
})

test('shows a reload notice when the server runs another build', async () => {
  const admin = mountAdmin('/admin/', { admin: 'old-build', server: 'new-build' })
  await expect.poll(admin.text).toContain('Je dostupná nová verzia administrácie.')
})

test('shows no reload notice when the builds match', async () => {
  const admin = mountAdmin('/admin/')
  await expect.poll(admin.text).toContain('hello widget')
  expect(admin.text()).not.toContain('Je dostupná nová verzia administrácie.')
})

const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) =>
    el.textContent?.includes(name),
  )

test('the user menu holds the account settings, the language and sign-out', async () => {
  const user = await seedUser(db.url, { name: 'Menu User', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const admin = mountAdmin('/admin/', { as: own })
  await expect.poll(admin.text).toContain('Prehľad')
  // The account is no longer a nav item.
  expect(navText()).not.toContain('Môj účet')

  const trigger = document.querySelector<HTMLElement>('[aria-label="Používateľské menu"]')!
  expect(trigger.textContent).toContain('Menu User')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => menuItem('Nastavenia účtu')).toBeDefined()
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(user.email)
  expect(menuItem('Odhlásiť sa')).toBeDefined()

  menuItem('Jazyk')!.click()
  await expect.poll(() => menuItem('English')).toBeDefined()
  menuItem('English')!.click()
  // Applied in the shell, and saved on the user.
  await expect.poll(() => document.documentElement.lang).toBe('en')
  await expect.poll(admin.text).toContain('Dashboard')
  const me = await hosts.b1.browserFetch({ cookie: own })(new URL('/api/me', location.origin))
  expect(await me.json()).toMatchObject({ locale: 'en' })
})

test('a saved language applies even if reading /me again would fail', async () => {
  const user = await seedUser(db.url, { name: 'Flaky User', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  let meCalls = 0
  // The first /me loads the shell; any later one fails.
  const wrapFetch =
    (f: typeof fetch): typeof fetch =>
    async (input, init) =>
      String(input).endsWith('/api/me') && ++meCalls > 1
        ? new Response('down', { status: 503 })
        : f(input, init)
  const admin = mountAdmin('/admin/', { as: own, wrapFetch })
  await expect.poll(admin.text).toContain('Prehľad')
  document
    .querySelector<HTMLElement>('[aria-label="Používateľské menu"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => menuItem('Jazyk')).toBeDefined()
  menuItem('Jazyk')!.click()
  await expect.poll(() => menuItem('English')).toBeDefined()
  menuItem('English')!.click()
  await expect.poll(() => document.documentElement.lang).toBe('en')
  await expect.poll(admin.text).toContain('Dashboard')
  expect(admin.text()).not.toContain('could not reach the server')
})

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const heldCatalogs = (holding = true) => {
  const held = Promise.withResolvers<void>()
  onTestFinished(() => held.resolve())
  const loads: Array<Promise<unknown>> = []
  let asked = false
  const hold =
    <T>(load: () => Promise<T>) =>
    async () => {
      if (holding) {
        asked = true
        await held.promise
      }
      const loaded = load()
      loads.push(loaded)
      return loaded
    }
  return {
    modules: adminModules.map((m) => ({
      ...m,
      messages: { en: hold(m.messages.en), sk: hold(m.messages.sk) },
    })),
    hold: () => {
      holding = true
    },
    asked: () => asked,
    release: async () => {
      held.resolve()
      await tick()
      await Promise.all(loads)
      await tick(50)
      expect(loads.length).toBeGreaterThan(0)
    },
  }
}

const mountDisposable = (
  modules: typeof adminModules,
  session: string,
  {
    overrides = {},
    onRequest = () => {},
  }: {
    overrides?: NonNullable<AdminOptions['overrides']>
    onRequest?: (url: string) => Promise<void> | void
  } = {},
) => {
  let requested = false
  history.replaceState(null, '', '/admin/')
  const app = createAdmin({
    brand,
    modules,
    buildId: 'b1',
    overrides,
    fetch: async (input, init) => {
      await onRequest(String(input instanceof Request ? input.url : input))
      const response = await hosts.b1.browserFetch({ cookie: session })(input, init)
      requested = true
      return response
    },
  })
  document.body.innerHTML = '<div id="app"></div>'
  app.mount('#app')
  let mounted = true
  onTestFinished(() => {
    if (mounted) app.unmount()
  })
  return {
    requested: () => requested,
    unmount: () => {
      mounted = false
      app.unmount()
    },
  }
}

test('an unmounted admin leaves the document language alone when its catalogs arrive late', async () => {
  const lang = document.documentElement.lang
  onTestFinished(() => {
    document.documentElement.lang = lang
  })
  document.documentElement.lang = 'xx'
  const catalogs = heldCatalogs()
  const admin = mountDisposable(catalogs.modules, cookie)
  await expect.poll(admin.requested).toBe(true)
  await tick()
  admin.unmount()
  await catalogs.release()
  expect(document.documentElement.lang).toBe('xx')
})

test('an unmounted admin stops following the browser history', async () => {
  const admin = mountDisposable(adminModules, cookie)
  await expect.poll(() => document.querySelector('nav')).toBeTruthy()
  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await tick()
  expect(location.pathname).toBe('/elsewhere')
})

test('an unmounted admin does not redirect when its catalogs arrive late', async () => {
  const catalogs = heldCatalogs()
  const admin = mountDisposable(catalogs.modules, '')
  await expect.poll(admin.requested).toBe(true)
  await tick()
  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  await catalogs.release()
  expect(location.pathname).toBe('/elsewhere')
})

const capturedState = () => {
  let captured: AdminState | undefined
  return {
    overrides: {
      dashboard: async () => ({
        default: defineComponent(() => {
          captured = useAdmin()
          return () => h('p', 'state captured')
        }),
      }),
    },
    state: () => {
      if (!captured) throw new Error('the dashboard has not rendered')
      return captured
    },
  }
}

const navigate = (path: string) => {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

test('an unmounted admin does not roll back a navigation that resumes late', async () => {
  const catalogs = heldCatalogs(false)
  const dashboard = capturedState()
  const admin = mountDisposable(catalogs.modules, cookie, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  catalogs.hold()
  const refreshed = dashboard.state().refresh()
  navigate('/admin/nowhere')
  await tick()
  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  await catalogs.release()
  await refreshed
  await tick(50)
  expect(location.pathname).toBe('/elsewhere')
})

test('an unmounted admin ignores a deploy check that answers late', async () => {
  const dashboard = capturedState()
  const held = Promise.withResolvers<void>()
  onTestFinished(() => held.resolve())
  let holding = false
  let heldMe = false
  const admin = mountDisposable(adminModules, cookie, {
    overrides: dashboard.overrides,
    onRequest: async (url) => {
      if (!holding || !url.endsWith('/api/me')) return
      heldMe = true
      await held.promise
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const before = dashboard.state().me.value
  expect(before).toBeTruthy()
  holding = true
  navigate('/admin/nowhere')
  await expect.poll(() => heldMe).toBe(true)
  admin.unmount()
  held.resolve()
  await tick(50)
  expect(dashboard.state().me.value).toBe(before)
})

test('an unmounted admin ignores a screen that fails to load late', async () => {
  const failing = Promise.withResolvers<never>()
  failing.promise.catch(() => {})
  onTestFinished(() => failing.reject(new Error('late screen failure')))
  let unmounted = false
  let checksAfterUnmount = 0
  const admin = mountDisposable(adminModules, cookie, {
    overrides: { notFound: () => failing.promise },
    onRequest: (url) => {
      if (unmounted && url.endsWith('/api/me')) checksAfterUnmount++
    },
  })
  await expect.poll(() => document.querySelector('nav')).toBeTruthy()
  navigate('/admin/nowhere')
  await tick(50)
  admin.unmount()
  unmounted = true
  failing.reject(new Error('late screen failure'))
  await tick(50)
  expect(checksAfterUnmount).toBe(0)
})

const heldNextRequest = () => {
  const held = Promise.withResolvers<void>()
  onTestFinished(() => held.resolve())
  let holding = false
  let reached = false
  return {
    onRequest: async () => {
      if (!holding) return
      holding = false
      reached = true
      await held.promise
    },
    hold: () => {
      holding = true
    },
    reached: () => reached,
    release: () => held.resolve(),
  }
}

test('an unmounted admin does not redirect when a sign-out answers late', async () => {
  const user = await seedUser(db.url, { name: 'Late Sign-out', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const request = heldNextRequest()
  const admin = mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: request.onRequest,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const signOut = dashboard.state().signOut
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  request.hold()
  const signedOut = signOut().catch(() => {})
  await expect.poll(request.reached).toBe(true)
  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  request.release()
  await signedOut
  await tick(50)
  expect(location.pathname).toBe('/elsewhere')
  expect(dashboard.state().status.value).toBe('ready')
})

test('an unmounted admin keeps its user when a language change answers late', async () => {
  const user = await seedUser(db.url, { name: 'Late Language', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const request = heldNextRequest()
  const admin = mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: request.onRequest,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  const before = me.value
  request.hold()
  const changed = setLocale('en').catch(() => {})
  await expect.poll(request.reached).toBe(true)
  admin.unmount()
  request.release()
  await changed
  await tick(50)
  expect(me.value).toBe(before)
})

test('an unmounted admin keeps its user when the new language loads late', async () => {
  const user = await seedUser(db.url, { name: 'Late Catalogs', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const catalogs = heldCatalogs(false)
  const dashboard = capturedState()
  const admin = mountDisposable(catalogs.modules, own, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  const before = me.value
  catalogs.hold()
  const changed = setLocale('en').catch(() => {})
  await expect.poll(catalogs.asked).toBe(true)
  admin.unmount()
  await catalogs.release()
  await changed
  expect(me.value).toBe(before)
})

test('an unmounted admin keeps its state when a refresh answers late', async () => {
  const dashboard = capturedState()
  const request = heldNextRequest()
  const admin = mountDisposable(adminModules, cookie, {
    overrides: dashboard.overrides,
    onRequest: request.onRequest,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me, status } = dashboard.state()
  const before = me.value
  request.hold()
  const refreshed = refresh().catch(() => {})
  await expect.poll(request.reached).toBe(true)
  admin.unmount()
  request.release()
  await refreshed
  await tick(50)
  expect(me.value).toBe(before)
  expect(status.value).toBe('ready')
})
