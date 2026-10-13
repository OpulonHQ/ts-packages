import { createAdmin } from '@opulonjs/admin'
import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeHost, seedUser, tokenFrom } from './support/users.ts'

// Runs in the `admin` vitest project: the users screens in happy-dom, against the real Worker.
const db = useTestDatabase()
const host = makeHost(() => db.url, { buildId: 'b1' })

let mounted: { unmount: () => void } | undefined
function mountAdmin(path: string, jar = { cookie: '' }) {
  mounted?.unmount()
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const app = createAdmin({
    brand,
    modules: adminModules,
    buildId: 'b1',
    fetch: host.browserFetch(jar),
  })
  app.mount('#app')
  mounted = app
  onTestFinished(() => {
    if (mounted === app) app.unmount()
    mounted = undefined
  })
  return { jar, text: () => document.body.textContent ?? '' }
}

const inputs = () => [...document.querySelectorAll('input')]

/** Types into the screen's inputs in order and submits its form. */
async function fill(values: ReadonlyArray<string>) {
  await expect.poll(() => inputs().length).toBe(values.length)
  values.forEach((value, i) => {
    const input = inputs()[i]!
    input.value = value
    input.dispatchEvent(new Event('input'))
  })
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

test('signs in on the sign-in screen, lands on the requested page, and signs out', async () => {
  const user = await seedUser(db.url, { name: 'Sára', permissions: ['demo.notes.view'] })
  const admin = mountAdmin('/admin/demo/notes')
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')

  await fill([user.email, 'wrong password'])
  await expect.poll(admin.text).toContain('The email or password is wrong.')
  expect(admin.jar.cookie).toBe('')

  await fill([user.email, user.password])
  await expect.poll(admin.text).toContain('hello from demo')
  expect(location.pathname).toBe('/admin/demo/notes')
  expect(admin.text()).toContain('Sára')
  const session = admin.jar.cookie
  expect(session).toMatch(/session_token=/)

  document
    .querySelector<HTMLElement>('[aria-label="User menu"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  const signOut = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === 'Sign out',
    )
  await expect.poll(signOut).toBeDefined()
  signOut()!.click()
  await expect.poll(() => location.pathname).toBe('/admin/sign-in')
  expect(admin.jar.cookie).toBe('')
  expect((await host.request('GET', '/me', { cookie: session })).status).toBe(401)
})

test('an invitee opens the emailed link, sets a password and is signed in', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  await host.request('POST', '/users/invitations', {
    cookie: await host.signIn(owner.email, owner.password),
    body: { email: 'ines@example.test', roleIds: [] },
  })
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)

  const admin = mountAdmin(`/admin/accept-invitation#token=${encodeURIComponent(token)}`)
  await expect.poll(admin.text).toContain('You are invited as ines@example.test.')
  expect(location.hash).toBe('')
  await fill(['Inés', 'ines password 1', 'ines password 2'])
  await expect.poll(admin.text).toContain('The passwords do not match.')
  await fill(['Inés', 'ines password 1', 'ines password 1'])
  await expect.poll(() => location.pathname).toBe('/admin/')
  await expect.poll(admin.text).toContain('Inés')
})

test('an invalid invitation link says so', async () => {
  const admin = mountAdmin('/admin/accept-invitation#token=made-up')
  await expect.poll(admin.text).toContain('This invitation is invalid, used or expired.')
  expect(inputs()).toHaveLength(0)
})

test('a forgotten password is reset through the emailed link', async () => {
  const user = await seedUser(db.url)
  const admin = mountAdmin('/admin/forgot-password')
  await fill([user.email])
  await expect.poll(admin.text).toContain('If the address belongs to a user')
  const token = tokenFrom(host.mailer.sent.at(-1)!.html)
  admin.jar.cookie = ''

  const reset = mountAdmin(`/admin/reset-password#token=${encodeURIComponent(token)}`)
  await fill(['fresh password 1', 'fresh password 1'])
  await expect.poll(reset.text).toContain('Your password is set.')
  await host.signIn(user.email, 'fresh password 1')
})

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
/** Clicks the checkbox whose label reads `label`. */
function check(label: string) {
  const target = [...document.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  )?.htmlFor
  if (!target) throw new Error(`no checkbox labelled ${label}`)
  document.getElementById(target)!.click()
}
function type(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const row = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('tbody tr')].find((tr) =>
    tr.textContent?.includes(text),
  )

test('a Super admin reaches every composed admin screen', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const me = await host.me(await host.signIn(owner.email, owner.password))
  const needed = adminModules.flatMap((m) =>
    m.routes.flatMap((r) => (r.permission ? [r.permission] : [])),
  )
  expect(needed).toEqual(
    expect.arrayContaining(['emails.templates.manage', 'users.manage', 'users.roles.manage']),
  )
  expect(me.permissions).toEqual(expect.arrayContaining(needed))
})

test('creates a role from labelled permissions and assigns it on the user screen', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const member = await seedUser(db.url, { name: 'Milan Member', permissions: [] })
  const jar = { cookie: await host.signIn(owner.email, owner.password) }

  const roles = mountAdmin('/admin/roles', jar)
  await expect.poll(roles.text).toContain('Super admin')
  button('New role')!.click()
  await expect.poll(roles.text).toContain('View the email log')
  type('name', 'Mail watchers')
  check('View the email log')
  button('Save')!.click()
  await expect.poll(roles.text).toContain('The role is saved.')

  const users = mountAdmin('/admin/users', jar)
  await expect.poll(() => row('Milan Member')).toBeDefined()
  row('Milan Member')!.click()
  await expect.poll(() => location.pathname).toBe(`/admin/users/${member.id}`)
  await expect.poll(users.text).toContain('Mail watchers')
  check('Mail watchers')
  button('Save roles')!.click()
  await expect.poll(users.text).toContain('The roles are saved.')
  const cookie = await host.signIn(member.email, member.password)
  expect((await host.me(cookie)).permissions).toEqual(['emails.log.view'])

  button('Deactivate')!.click()
  await expect.poll(() => button('Deactivate the user')).toBeDefined()
  button('Deactivate the user')!.click()
  await expect.poll(users.text).toContain('This user is deactivated')
  expect((await host.request('GET', '/me', { cookie })).status).toBe(401)
})

test('says why a change is refused', async () => {
  const manager = await seedUser(db.url, { permissions: ['users.manage'] })
  const jar = { cookie: await host.signIn(manager.email, manager.password) }
  const admin = mountAdmin(`/admin/users/${manager.id}`, jar)
  await expect.poll(() => button('Deactivate')).toBeDefined()
  button('Deactivate')!.click()
  await expect.poll(() => button('Deactivate the user')).toBeDefined()
  button('Deactivate the user')!.click()
  await expect.poll(admin.text).toContain('You cannot take away your own access')
})

test('users pick their admin language on their account screen', async () => {
  const user = await seedUser(db.url, { permissions: [] })
  const jar = { cookie: await host.signIn(user.email, user.password) }
  const admin = mountAdmin('/admin/account', jar)
  await expect.poll(() => button('Slovenčina')).toBeDefined()
  button('Slovenčina')!.click()
  await expect.poll(admin.text).toContain('Jazyk administrácie')
  expect((await host.me(jar.cookie)).locale).toBe('sk')
})
