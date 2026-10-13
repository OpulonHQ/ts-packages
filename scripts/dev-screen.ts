import { Window } from 'happy-dom'
import { register } from 'node:module'

// Mounts the fixture admin from its dev server in happy-dom, signed in, on the cms Collections
// screen, and exits 0 once the screen shows the decoded items response.
// Usage: node scripts/dev-screen.ts <admin origin with base> <admin entry URL path>
register('./http-module-hooks.ts', import.meta.url)
const [origin, adminEntry] = process.argv.slice(2)
if (!origin || !adminEntry) throw new Error('usage: dev-screen.ts <origin> <admin entry>')

const window = new Window({ url: `${origin}cms/collections/posts` })
const globals = globalThis as unknown as Record<string, unknown>
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globals)) globals[key] = window[key as keyof Window]
}
Object.assign(globals, { window, document: window.document, location: window.location })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator })
window.document.body.innerHTML = '<div id="app"></div>'

interface AdminModule {
  readonly id: string
}
const { createAdmin } = (await import(new URL(adminEntry, origin).href)) as {
  createAdmin: (options: object) => { mount: (selector: string) => void }
}
const { adminModules } = (await import(`${origin}modules.ts`)) as {
  adminModules: ReadonlyArray<AdminModule>
}
const { brand } = (await import(`${origin}brand.ts`)) as { brand: object }

const me = {
  buildId: 'pack-check',
  user: { id: 'u', name: 'U', email: 'u@example.com' },
  locale: null,
  permissions: ['cms.collections.view'],
  modules: adminModules.map((m) => m.id),
  permissionCatalog: [],
  contentLocales: ['en'],
}
const row = {
  id: 'i1',
  collection: 'posts',
  title: 'Decoded pack-check item',
  path: '/decoded',
  status: 'draft',
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishedAt: null,
}
const responses: Record<string, unknown> = {
  '/api/me': me,
  '/api/cms/collections/posts/items': { rows: [row], total: 1 },
}
const fetch = async (url: string | URL) => {
  const body = responses[new URL(url, origin).pathname]
  return body ? Response.json(body) : new Response(null, { status: 404 })
}
createAdmin({
  brand,
  modules: adminModules,
  apiPrefix: '/api',
  buildId: 'pack-check',
  fetch,
}).mount('#app')

const text = () => window.document.body.textContent
const settled = () => text().includes(row.title) || text().includes('The data could not be loaded.')
for (let i = 0; i < 100 && !settled(); i++) await new Promise((r) => setTimeout(r, 100))
if (!text().includes(row.title)) {
  console.error(text())
  process.exit(1)
}
process.exit(0)
