import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeHost, seedUser } from './support/users.ts'

const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(makeHost(() => db.url, { buildId: 'b1' }))

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const held = (matches: (request: Request) => boolean, at: 'request' | 'answer' = 'request') => {
  const gate = lifetime.gate()
  let state: 'waiting' | 'reached' | 'done' = 'waiting'
  const wrap =
    (fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
    async (input, init) => {
      if (state !== 'waiting' || !matches(new Request(input, init))) return fetch(input, init)
      state = 'reached'
      try {
        if (at === 'request') await gate.promise
        const response = await fetch(input, init)
        if (at === 'answer') await gate.promise
        return response
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
  const text = lifetime.mount(path, { buildId: 'b1', fetch })
  return { text, unmount: text.unmount }
}

const languagesShown = () => {
  const shown: Array<string> = []
  const observer = new MutationObserver(() => shown.push(document.documentElement.lang))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  onTestFinished(() => observer.disconnect())
  return shown
}

const isLocaleSave = (request: Request) =>
  request.method === 'PUT' && new URL(request.url).pathname.endsWith('/locale')

const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) =>
    el.textContent?.includes(name),
  )

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
  const shown = languagesShown()

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
  expect(shown).not.toContain('en')
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

test('a language pick made while the read after an earlier save loads shows only the last pick', async () => {
  const user = await seedUser(db.url, { name: 'Pick During Read', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  let saved = 0
  const counting: typeof globalThis.fetch = async (input, init) => {
    const response = await host.browserFetch(jar)(input, init)
    if (isLocaleSave(new Request(input, init))) saved++
    return response
  }
  const firstRead = held(
    (request) =>
      saved === 1 && request.method === 'GET' && new URL(request.url).pathname === '/api/me',
    'answer',
  )
  const secondSave = held((request) => saved === 1 && isLocaleSave(request))
  const admin = mount('/admin/', firstRead.wrap(secondSave.wrap(counting)))
  await expect.poll(admin.text).toContain('Prehľad')
  const shown = languagesShown()

  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(firstRead.reached).toBe(true)
  await pickLanguage('Používateľské menu', 'Jazyk', 'Slovenčina')
  await expect.poll(secondSave.reached).toBe(true)
  firstRead.release()
  await expect.poll(firstRead.done).toBe(true)
  await tick(100)
  secondSave.release()
  await expect.poll(() => saved).toBe(2)
  await tick(100)

  expect(await host.me(jar.cookie)).toMatchObject({ locale: 'sk' })
  expect(document.documentElement.lang).toBe('sk')
  expect(admin.text()).toContain('Prehľad')
  expect(shown).not.toContain('en')
})

test('an earlier saved language shows when a newer save and the reads after it fail', async () => {
  const user = await seedUser(db.url, { name: 'Failure Fallback', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const first = held(isLocaleSave, 'answer')
  let saves = 0
  const server: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (isLocaleSave(request) && ++saves === 2) return new Response('down', { status: 503 })
    if (saves > 0 && request.method === 'GET' && new URL(request.url).pathname === '/api/me')
      return new Response('down', { status: 503 })
    return host.browserFetch(jar)(input, init)
  }
  const admin = mount('/admin/', first.wrap(server))
  await expect.poll(admin.text).toContain('Prehľad')

  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(async () => (await host.me(jar.cookie)).locale).toBe('en')
  await pickLanguage('Používateľské menu', 'Jazyk', 'Slovenčina')
  first.release()
  await expect.poll(() => saves).toBe(2)
  await expect.poll(admin.text).toContain('Jazyk sa nepodarilo uložiť.')

  expect((await host.me(jar.cookie)).locale).toBe('en')
  await expect.poll(() => document.documentElement.lang).toBe('en')
})

test('a language pick still queued when the admin unmounts is never saved', async () => {
  const user = await seedUser(db.url, { name: 'Unmounted Queue', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const first = held(isLocaleSave)
  let oldSaves = 0
  const oldServer: typeof globalThis.fetch = async (input, init) => {
    if (isLocaleSave(new Request(input, init))) oldSaves++
    return host.browserFetch(jar)(input, init)
  }
  const old = mount('/admin/', first.wrap(oldServer))
  await expect.poll(old.text).toContain('Prehľad')
  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(first.reached).toBe(true)
  await pickLanguage('Používateľské menu', 'Jazyk', 'Slovenčina')
  old.unmount()

  const next = mount('/admin/', host.browserFetch(jar))
  await expect.poll(next.text).toContain('Prehľad')
  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(() => document.documentElement.lang).toBe('en')
  first.release()
  await expect.poll(first.done).toBe(true)
  await tick(100)

  expect(oldSaves).toBe(1)
  expect((await host.me(jar.cookie)).locale).toBe('en')
  expect(document.documentElement.lang).toBe('en')
})

test('a language save that answers after a sign-out does not keep the user signed in when reads fail', async () => {
  const user = await seedUser(db.url, { name: 'Save Then Sign-out', locale: 'sk' })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const session = jar.cookie
  let signedOut = false
  const save = held(isLocaleSave, 'answer')
  const read = held(
    (request) =>
      signedOut && request.method === 'GET' && new URL(request.url).pathname === '/api/me',
  )
  const server: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname
    if (signedOut && path === '/api/me') return new Response('down', { status: 503 })
    const response = await host.browserFetch(jar)(input, init)
    if (path.endsWith('/auth/sign-out')) signedOut = true
    return response
  }
  const admin = mount('/admin/', save.wrap(read.wrap(server)))
  await expect.poll(admin.text).toContain('Prehľad')

  await pickLanguage('Používateľské menu', 'Jazyk', 'English')
  await expect.poll(async () => (await host.me(session)).locale).toBe('en')
  document
    .querySelector<HTMLElement>('[aria-label="Používateľské menu"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => menuItem('Odhlásiť sa')).toBeDefined()
  menuItem('Odhlásiť sa')!.click()
  await expect.poll(read.reached).toBe(true)

  save.release()
  await expect.poll(save.done).toBe(true)
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
  read.release()
  await expect.poll(read.done).toBe(true)
  await tick(100)
  expect(location.pathname).toBe('/admin/sign-in')
  expect((await host.request('GET', '/me', { cookie: session })).status).toBe(401)
})
