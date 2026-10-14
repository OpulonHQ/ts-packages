import { Window } from 'happy-dom'
import { register } from 'node:module'

register('./http-module-hooks.ts', import.meta.url)
const [origin, entry, session] = process.argv.slice(2)
if (!origin || !entry || !session)
  throw new Error('usage: first-route-page.ts <origin> <entry> <me JSON>')

const window = new Window({ url: `${origin}/admin/` })
const globals = globalThis as unknown as Record<string, unknown>
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globals)) globals[key] = window[key as keyof Window]
}
Object.assign(globals, { window, document: window.document, location: window.location })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator })
window.document.body.innerHTML = '<div id="app"></div>'

const me: unknown = JSON.parse(session)
const assets = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, origin)
  if (!url.pathname.startsWith('/api/')) return assets(url, init)
  return url.pathname === '/api/me' ? Response.json(me) : Response.json({}, { status: 404 })
}

await import(new URL(entry, origin).href)
const dashboard = () => window.document.querySelector('section[aria-label]')
for (let i = 0; i < 200 && !dashboard(); i++) await new Promise((done) => setTimeout(done, 100))
if (!dashboard()) {
  console.error(window.document.body.textContent)
  process.exit(1)
}
await new Promise((done) => setTimeout(done, 2_000))
const preloads = [...window.document.querySelectorAll('link[rel="modulepreload"]')]
console.log(
  JSON.stringify(preloads.map((link) => new URL(link.getAttribute('href')!, origin).pathname)),
)
process.exit(0)
