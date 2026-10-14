import {
  type AdminOptions,
  type AdminState,
  createAdmin,
  defineAdminModule,
  useAdmin,
} from '@opulonjs/admin'
import { defineComponent, h, watch } from 'vue'
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeHost, seedUser } from './support/users.ts'

// Runs in the `admin` vitest project: happy-dom, built by the opulonAdmin() preset.
const lifetime = useAdminLifetime()
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
  b1: lifetime.track(makeHost(() => db.url, { buildId: 'b1' })),
  'new-build': lifetime.track(makeHost(() => db.url, { buildId: 'new-build' })),
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
  const text = lifetime.mount(path, {
    modules: [...adminModules, coreScreens, ghost],
    buildId: admin,
    fetch: wrapFetch(hosts[server].browserFetch({ cookie: signedIn ? (as ?? cookie) : '' })),
  })
  return { text }
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
  session: string | (() => string),
  {
    overrides = {},
    onRequest = () => {},
    onResponse = () => {},
    host = () => hosts.b1,
    rewrite = (_url, response) => response,
  }: {
    overrides?: NonNullable<AdminOptions['overrides']>
    onRequest?: (url: string) => Promise<void> | void
    onResponse?: (url: string) => Promise<void> | void
    host?: () => (typeof hosts)[keyof typeof hosts]
    rewrite?: (url: string, response: Response) => Promise<Response> | Response
  } = {},
) => {
  let requested = false
  const { app, unmount } = lifetime.mount('/admin/', {
    modules,
    buildId: 'b1',
    overrides,
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      await onRequest(url)
      const cookie = typeof session === 'string' ? session : session()
      const response = await host().browserFetch({ cookie })(input, init)
      requested = true
      await onResponse(url)
      return rewrite(url, response)
    },
  })
  return {
    app,
    state: () => app.runWithContext(useAdmin),
    requested: () => requested,
    unmount,
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
  const { me, status } = admin.state()
  admin.unmount()
  await catalogs.release()
  expect(document.documentElement.lang).toBe('xx')
  expect(me.value).toBeUndefined()
  expect(status.value).toBe('loading')
})

test('an unmounted admin merges no catalog that arrives late', async () => {
  const catalogs = heldCatalogs()
  const admin = mountDisposable(catalogs.modules, cookie)
  await expect.poll(admin.requested).toBe(true)
  await expect.poll(catalogs.asked).toBe(true)
  const { $te } = admin.app.config.globalProperties
  admin.unmount()
  await catalogs.release()
  expect($te('demo.nav.notes', 'en')).toBe(false)
  expect($te('demo.nav.notes', 'sk')).toBe(false)
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
  const { status } = admin.state()
  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  await catalogs.release()
  expect(location.pathname).toBe('/elsewhere')
  expect(status.value).toBe('loading')
})

test('an unmounted admin stays loading when /me fails late', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  const held = Promise.withResolvers<void>()
  onTestFinished(() => held.resolve())
  let asked = false
  const admin = mountDisposable(adminModules, cookie, {
    onRequest: async (url) => {
      if (!url.endsWith('/api/me')) return
      asked = true
      await held.promise
      throw new Error('/me is down')
    },
  })
  await expect.poll(() => asked).toBe(true)
  const { status } = admin.state()
  admin.unmount()
  held.resolve()
  await tick(50)
  expect(status.value).toBe('loading')
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

test('a refresh started after unmount writes nothing', async () => {
  const lang = document.documentElement.lang
  onTestFinished(() => {
    document.documentElement.lang = lang
  })
  const dashboard = capturedState()
  const admin = mountDisposable(adminModules, cookie, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me } = dashboard.state()
  const before = me.value
  admin.unmount()
  document.documentElement.lang = 'xx'
  await refresh()
  expect(me.value).toBe(before)
  expect(document.documentElement.lang).toBe('xx')
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

const heldAnswer = (path = '/api/me') => {
  const held = Promise.withResolvers<void>()
  onTestFinished(() => held.resolve())
  let holding = false
  let answered = false
  return {
    onResponse: async (url: string) => {
      if (!holding || !url.endsWith(path)) return
      holding = false
      answered = true
      await held.promise
    },
    hold: () => {
      holding = true
    },
    answered: () => answered,
    release: async () => {
      held.resolve()
      await tick(50)
    },
  }
}

test('a deploy check that answers after a sign-out leaves the user signed out', async () => {
  const user = await seedUser(db.url, { name: 'Check Sign-out', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { signOut, me, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  answer.hold()
  navigate('/admin/nowhere')
  await expect.poll(answer.answered).toBe(true)
  await signOut()
  expect(status.value).toBe('signedOut')
  await answer.release()
  expect(me.value).toBeUndefined()
  expect(status.value).toBe('signedOut')
})

test('a deploy check that answers after a language change keeps the new language', async () => {
  const user = await seedUser(db.url, { name: 'Check Language', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  navigate('/admin/nowhere')
  await expect.poll(answer.answered).toBe(true)
  await setLocale('en')
  expect(me.value?.locale).toBe('en')
  await answer.release()
  expect(me.value?.locale).toBe('en')
})

test('a deploy check that answers after a refresh keeps the refreshed user', async () => {
  const dashboard = capturedState()
  const answer = heldAnswer()
  mountDisposable(adminModules, cookie, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me } = dashboard.state()
  answer.hold()
  navigate('/admin/nowhere')
  await expect.poll(answer.answered).toBe(true)
  await refresh()
  const refreshed = me.value
  await answer.release()
  expect(me.value).toBe(refreshed)
})

test('a refresh that answers after a sign-out leaves the user signed out', async () => {
  const user = await seedUser(db.url, { name: 'Refresh Sign-out', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, signOut, me, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  answer.hold()
  const refreshed = refresh()
  await expect.poll(answer.answered).toBe(true)
  const signedOut = signOut()
  await expect.poll(() => status.value).toBe('signedOut')
  await answer.release()
  await Promise.all([refreshed, signedOut])
  expect(me.value).toBeUndefined()
  expect(status.value).toBe('signedOut')
})

test.each(['refresh', 'setLocale'] as const)(
  'a sign-out still applies when a %s finishes while it is pending',
  async (newer) => {
    const user = await seedUser(db.url, { name: `Pending Sign-out ${newer}`, locale: 'sk' })
    const own = await hosts.b1.signIn(user.email, user.password)
    const dashboard = capturedState()
    const request = heldNextRequest()
    mountDisposable(adminModules, own, {
      overrides: dashboard.overrides,
      onRequest: request.onRequest,
    })
    await expect.poll(() => document.body.textContent).toContain('state captured')
    const { refresh, signOut, setLocale, me, status } = dashboard.state()
    if (!signOut || !setLocale) throw new Error('the auth provider offers no sign-out or language')
    request.hold()
    const signedOut = signOut()
    await expect.poll(request.reached).toBe(true)
    await (newer === 'refresh' ? refresh() : setLocale('en'))
    request.release()
    await signedOut
    expect(status.value).toBe('signedOut')
    expect(me.value).toBeUndefined()
  },
)

test('a language save still applies when a refresh finishes while it is pending', async () => {
  const user = await seedUser(db.url, { name: 'Pending Language', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const request = heldNextRequest()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: request.onRequest,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  request.hold()
  const changed = setLocale('en')
  await expect.poll(request.reached).toBe(true)
  await refresh()
  request.release()
  await changed
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('the later of two language changes wins in the shell', async () => {
  const user = await seedUser(db.url, { name: 'Two Languages', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const first = setLocale('en')
  await expect.poll(answer.answered).toBe(true)
  const second = setLocale('sk')
  await answer.release()
  await Promise.all([first, second])
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('a deploy check does not cancel a language change that is still loading', async () => {
  const user = await seedUser(db.url, { name: 'Loading Language', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  let screenAsked = false
  let checks = 0
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: (url) => {
      if (url.endsWith('/api/me')) checks++
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  const changed = setLocale('en')
  await expect.poll(catalogs.asked).toBe(true)
  const beforeCheck = checks
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => checks).toBeGreaterThan(beforeCheck)
  await tick(50)
  await catalogs.release()
  await changed
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('a language save that answers after a sign-out leaves the signed-out shell alone', async () => {
  const user = await seedUser(db.url, { name: 'Language Then Sign-out', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, signOut, status } = dashboard.state()
  if (!signOut || !setLocale) throw new Error('the auth provider offers no sign-out or language')
  answer.hold()
  const changed = setLocale('en')
  await expect.poll(answer.answered).toBe(true)
  await signOut()
  await answer.release()
  await changed
  expect(status.value).toBe('signedOut')
  expect(document.documentElement.lang).toBe('sk')
})

type Seeded = Awaited<ReturnType<typeof seedUser>>

const signInInEnglish = async (user: Seeded) => {
  const session = await hosts.b1.signIn(user.email, user.password)
  const { id } = (await hosts.b1.me(session)).user
  const saved = await hosts.b1.request('PUT', `/users/users/${id}/locale`, {
    cookie: session,
    body: { locale: 'en' },
  })
  expect(saved.status).toBe(204)
  return session
}

const lateLanguageInNextSession = async (
  next: (current: {
    user: Seeded
    session: string
    signOut: () => Promise<void>
    refresh: () => Promise<void>
  }) => Promise<string>,
) => {
  const user = await seedUser(db.url, { name: 'Late Language Session', locale: 'en' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, () => session, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, signOut, refresh, me, status } = dashboard.state()
  if (!signOut || !setLocale) throw new Error('the auth provider offers no sign-out or language')
  answer.hold()
  const changed = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  session = await next({ user, session, signOut, refresh })
  await refresh()
  const current = me.value
  expect(status.value).toBe('ready')
  expect(current?.locale).toBe('en')
  await answer.release()
  await changed
  expect(me.value).toEqual(current)
  expect(document.documentElement.lang).toBe('en')
}

test('a language save from before a sign-out stays out of the same user’s next session', () =>
  lateLanguageInNextSession(async ({ user, signOut }) => {
    await signOut()
    return signInInEnglish(user)
  }))

test('a language save from a session that ended elsewhere stays out of the next one', () =>
  lateLanguageInNextSession(async ({ user, session, refresh }) => {
    expect(
      (await hosts.b1.request('POST', '/users/auth/sign-out', { cookie: session })).status,
    ).toBeLessThan(300)
    await refresh()
    return signInInEnglish(user)
  }))

test('a language save stays out of another user’s session signed in over it', () =>
  lateLanguageInNextSession(async () => {
    const other = await seedUser(db.url, { name: 'Next User', locale: 'en' })
    return hosts.b1.signIn(other.email, other.password)
  }))

test('a language save stays out of another user’s session that a deploy check shows', async () => {
  const user = await seedUser(db.url, { name: 'Save Before Other Tab', locale: 'en' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, () => session, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const changed = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  const other = await seedUser(db.url, { name: 'Signed In Elsewhere', locale: 'en' })
  session = await hosts.b1.signIn(other.email, other.password)
  const { id } = (await hosts.b1.me(session)).user
  navigate('/admin/nowhere')
  await expect.poll(() => me.value?.user.id).toBe(id)
  await answer.release()
  await changed
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('a cancelled refresh that answers signed out keeps the next session’s language save', async () => {
  const user = await seedUser(db.url, { name: 'Late Signed-out Read', locale: 'en' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const read = heldAnswer()
  const save = heldAnswer('/locale')
  mountDisposable(adminModules, () => session, {
    overrides: dashboard.overrides,
    onResponse: async (url) => {
      await read.onResponse(url)
      await save.onResponse(url)
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  await hosts.b1.request('POST', '/users/auth/sign-out', { cookie: session })
  read.hold()
  const cancelled = refresh()
  await expect.poll(read.answered).toBe(true)
  const other = await seedUser(db.url, { name: 'Current Session', locale: 'en' })
  session = await hosts.b1.signIn(other.email, other.password)
  await refresh()
  save.hold()
  const changed = setLocale('sk')
  await expect.poll(save.answered).toBe(true)
  await read.release()
  await cancelled
  await save.release()
  await changed
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('a language save still applies when a refresh fails while its catalogs load', async () => {
  const user = await seedUser(db.url, { name: 'Failing Refresh', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(catalogs.modules, own, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  catalogs.hold()
  const changed = setLocale('sk')
  await expect.poll(catalogs.asked).toBe(true)
  failing = true
  await refresh()
  await catalogs.release()
  await changed
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('an older language save applies when a newer one fails', async () => {
  const user = await seedUser(db.url, { name: 'Newer Save Fails', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  let saves = 0
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (url.endsWith('/locale') && ++saves === 2) throw new Error('second save failed')
    },
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const first = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  const second = expect(setLocale('en')).rejects.toThrow('second save failed')
  await answer.release()
  await Promise.all([first, second])
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('an older deploy check that answers after a language save ends at the server’s language', async () => {
  const user = await seedUser(db.url, { name: 'Check During Save', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const save = heldAnswer('/locale')
  const check = heldAnswer()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: async (url) => {
      await save.onResponse(url)
      await check.onResponse(url)
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  save.hold()
  const changed = setLocale('sk')
  await expect.poll(save.answered).toBe(true)
  check.hold()
  navigate('/admin/nowhere')
  await expect.poll(check.answered).toBe(true)
  await save.release()
  await changed
  await check.release()
  expect((await hosts.b1.me(own)).locale).toBe('sk')
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('a language save stays out of a shell whose deploy check found the session ended', async () => {
  const user = await seedUser(db.url, { name: 'Ended Before Save Answered', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me, status } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const changed = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  expect(
    (await hosts.b1.request('POST', '/users/auth/sign-out', { cookie: own })).status,
  ).toBeLessThan(300)
  navigate('/admin/nowhere')
  await expect.poll(() => status.value).toBe('signedOut')
  await answer.release()
  await changed
  expect(status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
  expect(document.documentElement.lang).toBe('en')
})

test('a sign-out still leads to the sign-in form when a refresh saw it first', async () => {
  const user = await seedUser(db.url, { name: 'Refresh Sees Sign-out', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/sign-out')
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { signOut, refresh, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  answer.hold()
  const done = signOut()
  await expect.poll(answer.answered).toBe(true)
  await refresh()
  await answer.release()
  await done
  expect(status.value).toBe('signedOut')
  await expect.poll(() => document.querySelector('input[type="password"]')).not.toBeNull()
  expect(location.pathname).toBe('/admin/sign-in')
})

test('a sign-out that failed does not undo an earlier one that succeeded', async () => {
  const user = await seedUser(db.url, { name: 'Second Sign-out Fails', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/sign-out')
  let signOuts = 0
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (url.endsWith('/sign-out') && ++signOuts === 2) throw new Error('second sign-out failed')
    },
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { signOut, me, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  answer.hold()
  const first = signOut()
  await expect.poll(answer.answered).toBe(true)
  await expect(signOut()).rejects.toThrow('second sign-out failed')
  await answer.release()
  await first
  expect(status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
  await expect.poll(() => document.querySelector('input[type="password"]')).not.toBeNull()
})

test('a language save stays out of another user’s shell when the read after it fails', async () => {
  const user = await seedUser(db.url, { name: 'Save Then Failed Read', locale: 'en' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, () => session, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const changed = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  const other = await seedUser(db.url, { name: 'Shown Before Failure', locale: 'en' })
  session = await hosts.b1.signIn(other.email, other.password)
  const { id } = (await hosts.b1.me(session)).user
  navigate('/admin/nowhere')
  await expect.poll(() => me.value?.user.id).toBe(id)
  failing = true
  await answer.release()
  await changed
  await tick(50)
  expect(me.value?.user.id).toBe(id)
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('a failed read does not bring back a language that a later read replaced', async () => {
  const user = await seedUser(db.url, { name: 'Replaced Language', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, refresh, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  await setLocale('sk')
  const { id } = (await hosts.b1.me(own)).user
  const saved = await hosts.b1.request('PUT', `/users/users/${id}/locale`, {
    cookie: own,
    body: { locale: 'en' },
  })
  expect(saved.status).toBe(204)
  await refresh()
  expect(me.value?.locale).toBe('en')
  failing = true
  await refresh()
  await tick(50)
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('a language save whose answer is lost still shows the language the server saved', async () => {
  const user = await seedUser(db.url, { name: 'Lost Answer', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: (url) => {
      if (url.endsWith('/locale')) throw new Error('answer lost')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  await expect(setLocale('sk')).rejects.toThrow('answer lost')
  expect((await hosts.b1.me(own)).locale).toBe('sk')
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
})

test('a sign-in whose read fails shows the failure instead of the sign-in form', async () => {
  const user = await seedUser(db.url, { name: 'Sign-in Read Fails', locale: 'en' })
  let session = ''
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  const admin = mountDisposable(adminModules, () => session, {
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => admin.state().status.value).toBe('signedOut')
  session = await hosts.b1.signIn(user.email, user.password)
  failing = true
  await admin.state().refresh()
  expect(admin.state().status.value).toBe('failed')
})

test('the last language picked stays when the reads after both saves fail', async () => {
  const user = await seedUser(db.url, { name: 'Older Save Answers Late', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  const shown: Array<string | null | undefined> = []
  onTestFinished(
    watch(
      () => me.value?.locale,
      (locale) => void shown.push(locale),
      { flush: 'sync' },
    ),
  )
  answer.hold()
  const first = setLocale('en')
  await expect.poll(answer.answered).toBe(true)
  const second = setLocale('sk')
  failing = true
  await answer.release()
  await Promise.all([first, second])
  await lifetime.settled()
  expect((await hosts.b1.me(own)).locale).toBe('sk')
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
  expect(shown).not.toContain('en')
})

test('a language picked while the last save still loads its catalogs shows only the last pick', async () => {
  const user = await seedUser(db.url, { name: 'Pick While Loading', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const answer = heldAnswer('/locale')
  mountDisposable(catalogs.modules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  const shown: Array<string | null | undefined> = []
  onTestFinished(
    watch(
      () => me.value?.locale,
      (locale) => void shown.push(locale),
      { flush: 'sync' },
    ),
  )
  catalogs.hold()
  const first = setLocale('en')
  await expect.poll(catalogs.asked).toBe(true)
  answer.hold()
  const second = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  await catalogs.release()
  await answer.release()
  await Promise.all([first, second])
  expect((await hosts.b1.me(own)).locale).toBe('sk')
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
  expect(shown).not.toContain('en')
})

test('a language picked while the fallback after a failed read loads its catalogs shows only the last pick', async () => {
  const user = await seedUser(db.url, { name: 'Fallback Catalog Race', locale: 'sk' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const answer = heldAnswer('/locale')
  let failing = false
  mountDisposable(catalogs.modules, own, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
    rewrite: (url, response) =>
      failing && url.endsWith('/api/me') ? new Response('down', { status: 503 }) : response,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  const shown: Array<string | null | undefined> = []
  onTestFinished(
    watch(
      () => me.value?.locale,
      (locale) => void shown.push(locale),
      { flush: 'sync' },
    ),
  )
  catalogs.hold()
  failing = true
  await setLocale('en')
  await expect.poll(catalogs.asked).toBe(true)
  answer.hold()
  const second = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  await catalogs.release()
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
  await answer.release()
  await second
  await lifetime.settled()
  expect((await hosts.b1.me(own)).locale).toBe('sk')
  expect(shown).not.toContain('en')
})

test('a language pick waiting for one user does not hold back the language of the next user shown', async () => {
  const waiting = await seedUser(db.url, { name: 'Waiting Account', locale: 'en' })
  const next = await seedUser(db.url, { name: 'Next Account', locale: 'sk' })
  let session = await hosts.b1.signIn(waiting.email, waiting.password)
  const nextSession = await hosts.b1.signIn(next.email, next.password)
  const nextId = (await hosts.b1.me(nextSession)).user.id
  const dashboard = capturedState()
  const answer = heldAnswer('/locale')
  mountDisposable(adminModules, () => session, {
    overrides: dashboard.overrides,
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, refresh, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  answer.hold()
  const pick = setLocale('sk')
  await expect.poll(answer.answered).toBe(true)
  session = nextSession
  await refresh()
  expect(me.value?.user.id).toBe(nextId)
  expect(me.value?.locale).toBe('sk')
  expect(document.documentElement.lang).toBe('sk')
  expect(
    (
      await hosts.b1.request('PUT', `/users/users/${nextId}/locale`, {
        cookie: nextSession,
        body: { locale: 'en' },
      })
    ).status,
  ).toBe(204)
  await refresh()
  expect(me.value?.locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
  await answer.release()
  await pick.catch(() => {})
  await lifetime.settled()
  expect(me.value?.user.id).toBe(nextId)
  expect(document.documentElement.lang).toBe('en')
})

test('a deploy check that finds the session ended cancels an older refresh still loading', async () => {
  const user = await seedUser(db.url, { name: 'Ended During Catalogs', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  let screenAsked = false
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me, status } = dashboard.state()
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  const refreshing = refresh()
  await expect.poll(catalogs.asked).toBe(true)
  expect(
    (await hosts.b1.request('POST', '/users/auth/sign-out', { cookie: own })).status,
  ).toBeLessThan(300)
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
  await catalogs.release()
  await refreshing
  await tick(100)
  expect((await hosts.b1.request('GET', '/me', { cookie: own })).status).toBe(401)
  expect(status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
})

test('an older refresh that answers with the previous user leaves the user a deploy check showed', async () => {
  const user = await seedUser(db.url, { name: 'Before Other Tab', locale: 'en' })
  const other = await seedUser(db.url, { name: 'After Other Tab', locale: 'en' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const answer = heldAnswer()
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  let screenAsked = false
  mountDisposable(adminModules, () => session, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: answer.onResponse,
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me } = dashboard.state()
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  answer.hold()
  const refreshing = refresh()
  await expect.poll(answer.answered).toBe(true)
  session = await hosts.b1.signIn(other.email, other.password)
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => me.value?.user.id).toBe(other.id)
  await answer.release()
  await refreshing
  await tick(50)
  expect(me.value?.user.id).toBe(other.id)
})

test('a deploy that lands while a refresh loads its catalogs still shows the reload notice', async () => {
  const user = await seedUser(db.url, { name: 'Deploy During Refresh', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  let screenAsked = false
  let server: keyof typeof hosts = 'b1'
  let reads = 0
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    host: () => hosts[server],
    onResponse: (url) => {
      if (url.endsWith('/api/me')) reads++
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, stale } = dashboard.state()
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  const refreshing = refresh()
  await expect.poll(catalogs.asked).toBe(true)
  server = 'new-build'
  const before = reads
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => reads).toBe(before + 2)
  await catalogs.release()
  await refreshing
  await expect.poll(() => stale.value).toBe(true)
})

test('a saved language stays when a deploy check answers during the read after it and that read fails', async () => {
  const user = await seedUser(db.url, { name: 'Check Then Failed Read', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  const readGate = Promise.withResolvers<void>()
  onTestFinished(() => readGate.resolve())
  let screenAsked = false
  let failNextRead = false
  let readHeld = false
  let reads = 0
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: async (url) => {
      if (!url.endsWith('/api/me')) return
      reads++
      if (!failNextRead) return
      failNextRead = false
      readHeld = true
      await readGate.promise
      throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  failNextRead = true
  const changed = setLocale('sk')
  await expect.poll(() => readHeld).toBe(true)
  const before = reads
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => reads).toBe(before + 2)
  readGate.resolve()
  await changed
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  expect(me.value?.locale).toBe('sk')
})

test('a deploy check with no read in flight reads /me once', async () => {
  const user = await seedUser(db.url, { name: 'One Check', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  let reads = 0
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onResponse: (url) => {
      if (url.endsWith('/api/me')) reads++
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const before = reads
  navigate('/admin/nowhere')
  await expect.poll(() => reads).toBe(before + 1)
  await tick(200)
  expect(reads).toBe(before + 1)
})

test('a deploy check that finds another user shows that user in their language', async () => {
  const user = await seedUser(db.url, { name: 'First In Tab', locale: 'en' })
  const other = await seedUser(db.url, { name: 'Second In Tab', locale: 'sk' })
  let session = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  mountDisposable(adminModules, () => session, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { me } = dashboard.state()
  session = await hosts.b1.signIn(other.email, other.password)
  navigate('/admin/nowhere')
  await expect.poll(() => me.value?.user.id).toBe(other.id)
  await expect.poll(() => document.documentElement.lang).toBe('sk')
})

test('an older refresh that settles while a newer one loads does not let a deploy check apply over it', async () => {
  const user = await seedUser(db.url, { name: 'Older Refresh Then Check', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  const meGate = Promise.withResolvers<void>()
  onTestFinished(() => meGate.resolve())
  let screenAsked = false
  let holdNextMe = false
  let meHeld = false
  let server: keyof typeof hosts = 'b1'
  let reads = 0
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    host: () => hosts[server],
    onResponse: async (url) => {
      if (!url.endsWith('/api/me')) return
      reads++
      if (!holdNextMe) return
      holdNextMe = false
      meHeld = true
      await meGate.promise
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, stale } = dashboard.state()
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  const first = refresh()
  await expect.poll(catalogs.asked).toBe(true)
  holdNextMe = true
  const second = refresh()
  await expect.poll(() => meHeld).toBe(true)
  await catalogs.release()
  await first
  server = 'new-build'
  const before = reads
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => reads).toBe(before + 2)
  meGate.resolve()
  await second
  await tick(150)
  expect(stale.value).toBe(true)
})

test('a saved language stays when the read a deploy check starts after a save fails', async () => {
  const user = await seedUser(db.url, { name: 'Save Then Check Then Failed Read', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  const readGate = Promise.withResolvers<void>()
  onTestFinished(() => readGate.resolve())
  let screenAsked = false
  let counting = false
  let reads = 0
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: async (url) => {
      if (!counting || !url.endsWith('/api/me')) return
      reads++
      if (reads === 1) await readGate.promise
      if (reads === 3) throw new Error('re-read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  counting = true
  const changed = setLocale('sk')
  await expect.poll(() => reads).toBe(1)
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => reads).toBe(3)
  readGate.resolve()
  await changed
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  expect(me.value?.locale).toBe('sk')
})

test('a language saved in another tab shows after the next navigation', async () => {
  const user = await seedUser(db.url, { name: 'Other Tab Language', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  mountDisposable(adminModules, own, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { me } = dashboard.state()
  const saved = await hosts.b1.request('PUT', `/users/users/${user.id}/locale`, {
    cookie: own,
    body: { locale: 'sk' },
  })
  expect(saved.status).toBe(204)
  navigate('/admin/nowhere')
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  expect(me.value?.locale).toBe('sk')
})

test('a saved language stays when a deploy check lands while its fallback loads', async () => {
  const user = await seedUser(db.url, { name: 'Check During Fallback', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  let screenAsked = false
  let failNextRead = false
  let reads = 0
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: (url) => {
      if (!url.endsWith('/api/me')) return
      reads++
      if (!failNextRead) return
      failNextRead = false
      throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  failNextRead = true
  await setLocale('sk')
  await expect.poll(catalogs.asked).toBe(true)
  const before = reads
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => reads).toBeGreaterThan(before)
  await tick(50)
  await catalogs.release()
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  expect(me.value?.locale).toBe('sk')
})

test('a deploy check compares with the language shown when it answers, not when it started', async () => {
  const user = await seedUser(db.url, { name: 'Fallback Before Check Answer', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const checkGate = Promise.withResolvers<void>()
  onTestFinished(() => checkGate.resolve())
  let failNextRead = false
  let holdNextRead = false
  let checkHeld = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(catalogs.modules, own, {
    overrides: dashboard.overrides,
    onResponse: async (url) => {
      if (!url.endsWith('/api/me')) return
      if (failNextRead) {
        failNextRead = false
        throw new Error('read failed')
      }
      if (!holdNextRead) return
      holdNextRead = false
      checkHeld = true
      await checkGate.promise
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, me } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  catalogs.hold()
  failNextRead = true
  await setLocale('sk')
  await expect.poll(catalogs.asked).toBe(true)
  const saved = await hosts.b1.request('PUT', `/users/users/${user.id}/locale`, {
    cookie: own,
    body: { locale: 'en' },
  })
  expect(saved.status).toBe(204)
  holdNextRead = true
  navigate('/admin/nowhere')
  await expect.poll(() => checkHeld).toBe(true)
  await catalogs.release()
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  checkGate.resolve()
  await expect.poll(() => me.value?.locale).toBe('en')
  await expect.poll(() => document.documentElement.lang).toBe('en')
})

test('a deploy check keeps the modules of a read that applied after it started', async () => {
  const user = await seedUser(db.url, { name: 'Modules After Check', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  const catalogs = heldCatalogs(false)
  const screenGate = Promise.withResolvers<Awaited<ReturnType<ReturnType<typeof screen>>>>()
  onTestFinished(() => screenGate.resolve(screen('slow screen')()))
  const checkGate = Promise.withResolvers<void>()
  onTestFinished(() => checkGate.resolve())
  let screenAsked = false
  let withoutEmails = false
  let holdNextRead = false
  let checkHeld = false
  mountDisposable(catalogs.modules, own, {
    overrides: {
      ...dashboard.overrides,
      'users.signIn': () => {
        screenAsked = true
        return screenGate.promise
      },
    },
    onResponse: async (url) => {
      if (!holdNextRead || !url.endsWith('/api/me')) return
      holdNextRead = false
      checkHeld = true
      await checkGate.promise
    },
    rewrite: async (url, response) => {
      if (!withoutEmails || !url.endsWith('/api/me') || !response.ok) return response
      const body = (await response.json()) as { modules: ReadonlyArray<string> }
      return Response.json({ ...body, modules: body.modules.filter((m) => m !== 'emails') })
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { refresh, me } = dashboard.state()
  expect(me.value?.modules).toContain('emails')
  navigate('/admin/sign-in')
  await expect.poll(() => screenAsked).toBe(true)
  catalogs.hold()
  withoutEmails = true
  const refreshing = refresh()
  await expect.poll(catalogs.asked).toBe(true)
  holdNextRead = true
  screenGate.resolve(await screen('slow screen')())
  await expect.poll(() => checkHeld).toBe(true)
  await catalogs.release()
  await refreshing
  expect(me.value?.modules).not.toContain('emails')
  const shown = me.value
  withoutEmails = false
  checkGate.resolve()
  await expect.poll(() => me.value !== shown).toBe(true)
  expect(me.value?.modules).not.toContain('emails')
})

test('a saved language whose fallback catalog fails to load logs the failure', async () => {
  const user = await seedUser(db.url, { name: 'Fallback Catalog Failure', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  const modules = adminModules.map((m) =>
    m.auth
      ? {
          ...m,
          messages: {
            ...m.messages,
            sk: async () => {
              if (failing) throw new Error('users catalog unavailable')
              return m.messages.sk()
            },
          },
        }
      : m,
  )
  mountDisposable(modules, own, {
    overrides: dashboard.overrides,
    onResponse: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { setLocale, status } = dashboard.state()
  if (!setLocale) throw new Error('the auth provider offers no language change')
  failing = true
  await setLocale('sk')
  await expect
    .poll(() => error.mock.calls.some(([e]) => String(e).includes('users catalog unavailable')))
    .toBe(true)
  expect(status.value).toBe('ready')
  expect(document.documentElement.lang).toBe('en')
})

test('a sign-out sticks when the read after it fails', async () => {
  const user = await seedUser(db.url, { name: 'Sign-out Then Failed Read', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  mountDisposable(adminModules, own, {
    overrides: dashboard.overrides,
    onRequest: (url) => {
      if (failing && url.endsWith('/api/me')) throw new Error('read failed')
    },
  })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { signOut, me, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  failing = true
  await signOut()
  expect(status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
})

test('a confirmed sign-out applies even if the sign-in messages fail to load', async () => {
  const user = await seedUser(db.url, { name: 'Catalog Failure Sign-out', locale: 'en' })
  const own = await hosts.b1.signIn(user.email, user.password)
  const dashboard = capturedState()
  let failing = false
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  const modules = adminModules.map((m) =>
    m.auth
      ? {
          ...m,
          messages: {
            ...m.messages,
            en: async () => {
              if (failing) throw new Error('auth catalog unavailable')
              return m.messages.en()
            },
          },
        }
      : m,
  )
  mountDisposable(modules, own, { overrides: dashboard.overrides })
  await expect.poll(() => document.body.textContent).toContain('state captured')
  const { signOut, me, status } = dashboard.state()
  if (!signOut) throw new Error('the auth provider offers no sign-out')
  failing = true
  await signOut()
  expect(status.value).toBe('signedOut')
  expect(me.value).toBeUndefined()
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
})
