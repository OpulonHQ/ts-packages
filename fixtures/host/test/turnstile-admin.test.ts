import { usersAdmin } from '@opulonjs/users/admin'
import { afterEach, expect, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { adminModules } from '../admin/modules.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { dummy, stubSiteverify } from './support/turnstile.ts'
import { makeHost, seedUser } from './support/users.ts'

const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(
  makeHost(() => db.url, {
    env: {
      USERS_TURNSTILE: 'true',
      USERS_TURNSTILE_SECRET: dummy.passSecret,
      USERS_TURNSTILE_HOSTNAMES: 'host.test',
    },
  }),
)
const modules = [
  usersAdmin({ turnstile: { siteKey: dummy.siteKey } }),
  ...adminModules.filter((m) => m.id !== 'users'),
]

type Widget = {
  readonly container: HTMLElement
  readonly sitekey: string
  readonly action: string
  readonly callback: (token: string) => void
}
const widgets: Array<Widget> = []
const resets: Array<string> = []
Object.defineProperty(window, 'turnstile', {
  configurable: true,
  value: {
    render: (container: HTMLElement, options: Omit<Widget, 'container'>) => {
      widgets.push({ container, ...options })
      return String(widgets.length)
    },
    reset: (id: string) => void resets.push(id),
    remove: () => {},
  },
})

const mountAdmin = (path: string) => {
  const jar = { cookie: '' }
  const text = lifetime.mount(path, { modules, fetch: host.browserFetch(jar) })
  return { jar, text }
}
const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!
const type = (values: ReadonlyArray<string>) =>
  [...document.querySelectorAll('input')].forEach((input, i) => {
    input.value = values[i]!
    input.dispatchEvent(new Event('input'))
  })

afterEach(() => {
  vi.unstubAllGlobals()
  widgets.length = 0
  resets.length = 0
})

test('the sign-in screen shows the widget and signs in with its token', async () => {
  const calls = stubSiteverify()
  const user = await seedUser(db.url, { name: 'Sára', permissions: ['demo.notes.view'] })
  const admin = mountAdmin('/admin/demo/notes')
  await expect.poll(() => widgets.length).toBe(1)
  expect(location.pathname).toBe('/admin/sign-in')
  const [widget] = widgets
  expect(widget).toMatchObject({ sitekey: dummy.siteKey, action: 'sign-in' })
  expect(document.querySelector('form')!.contains(widget!.container)).toBe(true)
  expect(submit().disabled).toBe(true)

  widget!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email, 'wrong password'])
  submit().click()
  await expect.poll(admin.text).toContain('The email or password is wrong.')
  expect(resets).toEqual(['1'])
  await expect.poll(() => submit().disabled).toBe(true)

  widget!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email, user.password])
  submit().click()
  await expect.poll(admin.text).toContain('hello from demo')
  expect(admin.jar.cookie).toMatch(/session_token=/)
  expect(calls.map((form) => form.get('response'))).toEqual([dummy.token, dummy.token])
})

test('a token the server refuses shows the check failed and asks for a new one', async () => {
  stubSiteverify(() => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }))
  const user = await seedUser(db.url)
  const admin = mountAdmin('/admin/sign-in')
  await expect.poll(() => widgets.length).toBe(1)
  widgets[0]!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email, user.password])
  submit().click()
  await expect.poll(admin.text).toContain('The check that you are human did not pass. Try again.')
  expect(resets).toEqual(['1'])
  expect(admin.jar.cookie).toBe('')
})

test('the forgotten-password screen shows the widget for its own action', async () => {
  stubSiteverify()
  const user = await seedUser(db.url)
  const sent = host.mailer.sent.length
  const admin = mountAdmin('/admin/forgot-password')
  await expect.poll(() => widgets.length).toBe(1)
  expect(widgets[0]).toMatchObject({ sitekey: dummy.siteKey, action: 'request-password-reset' })
  expect(submit().disabled).toBe(true)

  widgets[0]!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email])
  submit().click()
  await expect.poll(admin.text).toContain('an email with the link is on its way')
  expect(host.mailer.sent.length).toBe(sent + 1)
})

test('without the option the screens render no widget', async () => {
  const unguarded = lifetime.track(makeHost(() => db.url))
  const text = lifetime.mount('/admin/sign-in', { fetch: unguarded.browserFetch({ cookie: '' }) })
  await expect.poll(text).toContain('Forgot your password?')
  expect(widgets).toEqual([])
  expect(submit().disabled).toBe(false)
})

const notSetUp = 'The check that you are human is not set up correctly. Contact an administrator.'

test('a guarded server and an admin without the site key: both screens say the check is not set up', async () => {
  stubSiteverify()
  const user = await seedUser(db.url)
  const fetch = host.browserFetch({ cookie: '' })
  const signIn = lifetime.mount('/admin/sign-in', { fetch })
  await expect.poll(signIn).toContain('Forgot your password?')
  type([user.email, user.password])
  submit().click()
  await expect.poll(signIn).toContain(notSetUp)
  signIn.unmount()

  const forgot = lifetime.mount('/admin/forgot-password', { fetch })
  await expect.poll(forgot).toContain('Send the link')
  type([user.email])
  submit().click()
  await expect.poll(forgot).toContain(notSetUp)
})

test('an admin with the site key and an unguarded server: both screens say the check is not set up', async () => {
  stubSiteverify()
  const unguarded = lifetime.track(makeHost(() => db.url))
  const user = await seedUser(db.url)
  const jar = { cookie: '' }
  const fetch = unguarded.browserFetch(jar)
  const signIn = lifetime.mount('/admin/sign-in', { modules, fetch })
  await expect.poll(() => widgets.length).toBe(1)
  widgets[0]!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email, user.password])
  submit().click()
  await expect.poll(signIn).toContain(notSetUp)
  expect(jar.cookie).toBe('')
  signIn.unmount()

  const sent = unguarded.mailer.sent.length
  const forgot = lifetime.mount('/admin/forgot-password', { modules, fetch })
  await expect.poll(() => widgets.length).toBe(2)
  widgets[1]!.callback(dummy.token)
  await expect.poll(() => submit().disabled).toBe(false)
  type([user.email])
  submit().click()
  await expect.poll(forgot).toContain(notSetUp)
  expect(unguarded.mailer.sent.length).toBe(sent)
})
