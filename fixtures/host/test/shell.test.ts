import { createAdmin, defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import worker, { type Env } from '../worker.ts'
import { memoryBucket } from './memory-bucket.ts'

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

// Admin screens for core (composed on the server): one needs a permission the stub user lacks.
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

/** The admin's fetch, routed into the fixture host's Worker (no mocked API). */
const hostFetch =
  (serverBuildId: string, token: string | null): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init)
    if (token) request.headers.set('authorization', `Bearer ${token}`)
    const env: Env = {
      HYPERDRIVE: { connectionString: db.url },
      DEMO_TOKEN: 'test-token',
      OPULON_BUILD_ID: serverBuildId,
      ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
      MEDIA_BUCKET: memoryBucket(),
    }
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) })
    const body = await response.arrayBuffer()
    await Promise.all(pending)
    return new Response(body, response)
  }

function mountAdmin(
  path: string,
  { admin = 'b1', server = 'b1', token = 'test-token' as string | null } = {},
) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({
    brand,
    modules: [...adminModules, coreScreens, ghost],
    buildId: admin,
    fetch: hostFetch(server, token),
  })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return { text: () => document.body.textContent ?? '' }
}

const navText = () => document.querySelector('nav')?.textContent ?? ''

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
  const admin = mountAdmin('/admin/demo/notes', { token: null })
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
  expect(new URLSearchParams(location.search).get('redirect')).toBe('/demo/notes')
  await expect.poll(admin.text).toContain('Access token')
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
