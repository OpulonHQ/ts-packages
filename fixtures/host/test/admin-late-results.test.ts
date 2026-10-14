import { createAdmin } from '@opulonjs/admin'
import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeHost, seedUser } from './support/users.ts'

// Runs in the `admin` vitest project: the shell and users screens in happy-dom, against the real Worker.
const db = useTestDatabase()
const host = makeHost(() => db.url, { buildId: 'b1' })

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** Holds the next request whose URL matches until `release`; it then reaches the Worker. */
const held = (matches: (request: Request) => boolean) => {
  const gate = Promise.withResolvers<void>()
  onTestFinished(() => gate.resolve())
  let state: 'waiting' | 'reached' | 'done' = 'waiting'
  const wrap =
    (fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
    async (input, init) => {
      if (state !== 'waiting' || !matches(new Request(input, init))) return fetch(input, init)
      state = 'reached'
      await gate.promise
      try {
        return await fetch(input, init)
      } finally {
        state = 'done'
      }
    }
  return {
    wrap,
    reached: () => state !== 'waiting',
    done: () => state === 'done',
    release: () => gate.resolve(),
  }
}

const mount = (path: string, fetch: typeof globalThis.fetch) => {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({ brand, modules: adminModules, buildId: 'b1', fetch })
  app.mount('#app')
  let mounted = true
  onTestFinished(() => {
    if (mounted) app.unmount()
  })
  return {
    text: () => document.body.textContent ?? '',
    unmount: () => {
      mounted = false
      app.unmount()
    },
  }
}

const isLocaleSave = (request: Request) =>
  request.method === 'PUT' && new URL(request.url).pathname.endsWith('/locale')

const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) =>
    el.textContent?.includes(name),
  )

/** Picks a language in the shell's user menu, as a keyboard and pointer user does. */
async function pickLanguage(menu: string, language: string, name: string) {
  document
    .querySelector<HTMLElement>(`[aria-label="${menu}"]`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => menuItem(language)).toBeDefined()
  menuItem(language)!.click()
  await expect.poll(() => menuItem(name)).toBeDefined()
  menuItem(name)!.click()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await expect.poll(() => menuItem(language)).toBeUndefined()
}

test('a language save that fails after the admin unmounted shows no error in the next admin', async () => {
  const user = await seedUser(db.url, { name: 'Late Toast', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const save = held(isLocaleSave)
  const failing: typeof globalThis.fetch = async (input, init) =>
    isLocaleSave(new Request(input, init))
      ? new Response('down', { status: 503 })
      : host.browserFetch(jar)(input, init)
  const first = mount('/admin/', save.wrap(failing))
  await expect.poll(first.text).toContain('Prehľad')
  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(save.reached).toBe(true)
  first.unmount()

  const next = mount('/admin/', host.browserFetch(jar))
  await expect.poll(next.text).toContain('Prehľad')
  save.release()
  await expect.poll(save.done).toBe(true)
  await tick(100)
  expect(next.text()).not.toContain('Jazyk sa nepodarilo uložiť.')
  expect(next.text()).not.toContain('The language could not be saved.')
})

test('a sign-in that succeeds after the admin unmounted leaves the page where the host moved', async () => {
  const user = await seedUser(db.url, { name: 'Late Sign-in' })
  const jar = { cookie: '' }
  const signIn = held((request) => new URL(request.url).pathname.endsWith('/auth/sign-in'))
  const admin = mount('/admin/', signIn.wrap(host.browserFetch(jar)))
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
  await expect.poll(() => document.querySelectorAll('input').length).toBe(2)
  const [email, password] = document.querySelectorAll('input')
  email!.value = user.email
  email!.dispatchEvent(new Event('input'))
  password!.value = user.password
  password!.dispatchEvent(new Event('input'))
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  await expect.poll(signIn.reached).toBe(true)

  admin.unmount()
  history.replaceState(null, '', '/elsewhere')
  signIn.release()
  await expect.poll(signIn.done).toBe(true)
  await expect.poll(() => jar.cookie).toMatch(/session_token=/)
  await tick(100)
  expect(location.pathname).toBe('/elsewhere')
})

test('two quick language changes save and show the last one picked', async () => {
  const user = await seedUser(db.url, { name: 'Quick Picks', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const first = held(isLocaleSave)
  let saved = 0
  const counting: typeof globalThis.fetch = async (input, init) => {
    const response = await host.browserFetch(jar)(input, init)
    if (isLocaleSave(new Request(input, init))) saved++
    return response
  }
  const admin = mount('/admin/', first.wrap(counting))
  await expect.poll(admin.text).toContain('Prehľad')

  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(first.reached).toBe(true)
  await pickLanguage('Používateľské menu', 'Jazyk', 'Slovenčina')
  await tick(50)
  first.release()
  await expect.poll(() => saved).toBe(2)
  await tick(100)

  expect(await host.me(jar.cookie)).toMatchObject({ locale: 'sk' })
  await expect.poll(() => document.documentElement.lang).toBe('sk')
  expect(admin.text()).toContain('Prehľad')
})

test('a second language pick waits for a failed first save, then saves and shows', async () => {
  const user = await seedUser(db.url, { name: 'Queued Pick', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const first = held(isLocaleSave)
  let saves = 0
  const failingFirst: typeof globalThis.fetch = async (input, init) =>
    isLocaleSave(new Request(input, init)) && ++saves === 1
      ? new Response('down', { status: 503 })
      : host.browserFetch(jar)(input, init)
  const admin = mount('/admin/', first.wrap(failingFirst))
  await expect.poll(admin.text).toContain('Prehľad')

  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(first.reached).toBe(true)
  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await tick(50)
  expect(saves).toBe(0)
  expect(document.documentElement.lang).toBe('sk')
  expect(admin.text()).toContain('Prehľad')

  first.release()
  await expect.poll(admin.text).toContain('Jazyk sa nepodarilo uložiť.')
  await expect.poll(() => document.documentElement.lang).toBe('en')
  await expect.poll(admin.text).toContain('Dashboard')
  expect(saves).toBe(2)
  expect(await host.me(jar.cookie)).toMatchObject({ locale: 'en' })
})
