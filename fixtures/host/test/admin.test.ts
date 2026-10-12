// @vitest-environment happy-dom
import { createAdmin, defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { adminModules } from '../admin/modules.ts'
import worker, { type Env } from '../worker.ts'

const db = useTestDatabase()

// An admin module whose server module is not composed: /me does not list it.
const ghost = defineAdminModule({
  id: 'ghost',
  routes: [
    {
      name: 'ghost.home',
      path: '/ghost',
      signedIn: true,
      component: async () => ({ default: defineComponent(() => () => h('p', 'ghost screen')) }),
    },
  ],
  nav: [{ label: 'nav.home', route: 'ghost.home' }],
  messages: {
    en: async () => ({ default: { nav: { home: 'Ghost' } } }),
    sk: async () => ({ default: { nav: { home: 'Duch' } } }),
  },
})

/** The admin's fetch, routed into the fixture host's Worker (no mocked API). */
const hostFetch =
  (serverBuildId: string): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init)
    request.headers.set('authorization', 'Bearer test-token')
    const env: Env = {
      HYPERDRIVE: { connectionString: db.url },
      DEMO_TOKEN: 'test-token',
      OPULON_BUILD_ID: serverBuildId,
      ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    }
    const pending: Array<Promise<unknown>> = []
    const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) })
    const body = await response.arrayBuffer()
    await Promise.all(pending)
    return new Response(body, response)
  }

function mountAdmin(path: string, builds: { admin: string; server: string }) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({
    brand: { name: 'Fixture admin' },
    modules: [...adminModules, ghost],
    buildId: builds.admin,
    fetch: hostFetch(builds.server),
  })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return { text: () => document.body.textContent ?? '' }
}

test('the demo route renders and lists notes from its own API group', async () => {
  const admin = mountAdmin('/admin/demo/notes', { admin: 'b1', server: 'b1' })
  await expect.poll(admin.text).toContain('hello from demo')
  expect(admin.text()).toContain('Fixture admin')
  expect(admin.text()).toContain('Notes')
})

test('hides admin modules missing from /me, with a dev warning', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => warn.mockRestore())
  const admin = mountAdmin('/admin/ghost', { admin: 'b1', server: 'b1' })
  await expect.poll(admin.text).toContain('Notes')
  expect(admin.text()).not.toContain('Ghost')
  expect(admin.text()).not.toContain('ghost screen')
  expect(location.pathname).toBe('/admin/')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ghost"'))
})

test('shows a reload notice when the server runs another build', async () => {
  const admin = mountAdmin('/admin/', { admin: 'old-build', server: 'new-build' })
  await expect.poll(admin.text).toContain('A new admin version is available')
})

test('shows no reload notice when the builds match', async () => {
  const admin = mountAdmin('/admin/', { admin: 'b1', server: 'b1' })
  await expect.poll(admin.text).toContain('Notes')
  expect(admin.text()).not.toContain('A new admin version is available')
})
