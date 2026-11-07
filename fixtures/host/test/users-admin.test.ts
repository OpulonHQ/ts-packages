import { expect, onTestFinished, test, vi } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { adminModules } from '../admin/modules.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeHost, seedUser, tokenFrom } from './support/users.ts'

// Runs in the `admin` vitest project: the users screens in happy-dom, against the real Worker.
const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(makeHost(() => db.url, { buildId: 'b1' }))

let unmountPrevious = () => {}
function mountAdmin(path: string, jar = { cookie: '' }) {
  unmountPrevious()
  const text = lifetime.mount(path, { buildId: 'b1', fetch: host.browserFetch(jar) })
  unmountPrevious = text.unmount
  return { jar, text }
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

const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const bar = () => document.querySelector('[role="region"][aria-label="Unsaved changes"]')
/** Clicks the unsaved-changes bar's Save once it shows and no request of the screen runs. */
const saveFromBar = async () => {
  await expect.poll(() => bar() && button('Save', bar()!)?.disabled).toBe(false)
  button('Save', bar()!)!.click()
}
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
  await saveFromBar()
  await expect.poll(users.text).toContain('The roles are saved.')
  await expect.poll(bar).toBeNull()
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

test.each([
  ['account screen', [], () => '/admin/account'],
  ['own user screen', ['users.manage'], (id: string) => `/admin/users/${id}`],
])(
  'a language saved on the %s shows even if reading /me again fails',
  async (_, permissions, path) => {
    const user = await seedUser(db.url, { permissions })
    const jar = { cookie: await host.signIn(user.email, user.password) }
    const send = host.browserFetch(jar)
    let reads = 0
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => error.mockRestore())
    lifetime.mount(path(user.id), {
      buildId: 'b1',
      fetch: async (input, init) =>
        String(input instanceof Request ? input.url : input).endsWith('/api/me') && ++reads > 1
          ? new Response('down', { status: 503 })
          : send(input, init),
    })
    await expect.poll(() => button('Slovenčina')).toBeDefined()
    button('Slovenčina')!.click()
    await expect.poll(() => document.documentElement.lang).toBe('sk')
    expect(document.body.textContent).toContain('Jazyk administrácie')
  },
)

test.each([
  ['account screen', [], () => '/admin/account'],
  ['own user screen', ['users.manage'], (id: string) => `/admin/users/${id}`],
])(
  'the %s saves and shows the language when the auth provider cannot save it',
  async (_, permissions, path) => {
    const user = await seedUser(db.url, { permissions, locale: 'en' })
    const jar = { cookie: await host.signIn(user.email, user.password) }
    lifetime.mount(path(user.id), {
      modules: adminModules.map((m) =>
        m.auth ? { ...m, auth: { ...m.auth, setLocale: undefined } } : m,
      ),
      buildId: 'b1',
      fetch: host.browserFetch(jar),
    })
    await expect.poll(() => button('Slovenčina')).toBeDefined()
    button('Slovenčina')!.click()
    await expect.poll(() => document.documentElement.lang).toBe('sk')
    expect((await host.me(jar.cookie)).locale).toBe('sk')
  },
)

/** Whether the checkbox labelled `label` is checked. */
const checked = (label: string) => {
  const target = [...document.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  )?.htmlFor
  return target ? document.getElementById(target)?.getAttribute('aria-checked') : undefined
}
const discardDialog = () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
    d.textContent?.includes('Discard unsaved changes?'),
  )
const pressEscape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)

test('unsaved role toggles survive a language change and a refused save', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  await host.request('POST', '/users/roles', {
    cookie: await host.signIn(owner.email, owner.password),
    body: { name: 'Log readers', permissions: ['emails.log.view'] },
  })
  // A manager may change the language of a member, but not grant what the manager lacks.
  const manager = await seedUser(db.url, { permissions: ['users.manage'] })
  const member = await seedUser(db.url, { name: 'Mara Member', permissions: [] })
  const jar = { cookie: await host.signIn(manager.email, manager.password) }
  const admin = mountAdmin(`/admin/users/${member.id}`, jar)
  await expect.poll(() => checked('Log readers')).toBe('false')
  check('Log readers')
  await expect.poll(() => checked('Log readers')).toBe('true')

  button('Slovenčina')!.click()
  await expect.poll(admin.text).toContain('The admin language is saved.')
  expect(checked('Log readers')).toBe('true')
  await expect.poll(bar).toBeTruthy()

  await saveFromBar()
  await expect.poll(admin.text).toContain('You cannot grant a permission you do not hold')
  expect(checked('Log readers')).toBe('true')
  expect(bar()).toBeTruthy()
  const cookie = await host.signIn(member.email, member.password)
  expect((await host.me(cookie)).permissions).toEqual([])
})

test.each([
  { screen: '/admin/roles', open: 'New role', name: 'name', value: 'Half a role' },
  { screen: '/admin/users', open: 'Invite', name: 'email', value: 'half@example.test' },
])(
  'the $open slideover asks before closing with unsaved changes and closes at once without',
  async ({ screen, open, name, value }) => {
    const owner = await seedUser(db.url, { superAdmin: true })
    const admin = mountAdmin(screen, { cookie: await host.signIn(owner.email, owner.password) })
    await expect.poll(() => button(open)?.disabled).toBe(false)

    // Nothing typed yet: Cancel and Escape close without a question.
    button(open)!.click()
    await expect.poll(() => field(name)).toBeTruthy()
    button('Cancel')!.click()
    await expect.poll(() => field(name)).toBeNull()
    button(open)!.click()
    await expect.poll(() => field(name)).toBeTruthy()
    pressEscape()
    await expect.poll(() => field(name)).toBeNull()
    expect(discardDialog()).toBeUndefined()

    button(open)!.click()
    await expect.poll(() => field(name)).toBeTruthy()
    type(name, value)
    pressEscape()
    await expect.poll(discardDialog).toBeTruthy()
    button('Keep editing', discardDialog())!.click()
    await expect.poll(discardDialog).toBeUndefined()
    expect(field(name)!.value).toBe(value)

    button('Cancel')!.click()
    await expect.poll(discardDialog).toBeTruthy()
    button('Keep editing', discardDialog())!.click()
    await expect.poll(discardDialog).toBeUndefined()
    // The × asks too; Keep editing leaves the slideover open with what was typed.
    const closeButton = () => document.querySelector<HTMLButtonElement>('button[data-slot="close"]')
    closeButton()!.click()
    await expect.poll(discardDialog).toBeTruthy()
    button('Keep editing', discardDialog())!.click()
    await expect.poll(discardDialog).toBeUndefined()
    expect(field(name)!.value).toBe(value)
    expect(closeButton()).toBeTruthy()
    closeButton()!.click()
    await expect.poll(discardDialog).toBeTruthy()
    button('Discard changes', discardDialog())!.click()
    await expect.poll(() => field(name)).toBeNull()
    expect(admin.text()).not.toContain(value)
  },
)

test('a permission unchecked and checked again leaves the role without unsaved changes', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const cookie = await host.signIn(owner.email, owner.password)
  const permissions = ['emails.log.view', 'users.manage']
  await host.request('POST', '/users/roles', { cookie, body: { name: 'Two duties', permissions } })
  const roles = (await host.request('GET', '/users/roles', { cookie })).body as {
    roles: ReadonlyArray<{ name: string; permissions: ReadonlyArray<string> }>
  }
  const stored = roles.roles.find((r) => r.name === 'Two duties')!.permissions
  const labels: Record<string, string> = {
    'emails.log.view': 'View the email log',
    'users.manage': 'Invite and manage users',
  }
  mountAdmin('/admin/roles', { cookie })
  await expect.poll(() => row('Two duties')).toBeDefined()
  row('Two duties')!.click()
  await expect.poll(() => field('name')?.value).toBe('Two duties')

  // Checking it again puts the stored first permission last: still the same set.
  const first = labels[stored[0]!]!
  check(first)
  await expect.poll(() => checked(first)).toBe('false')
  check(first)
  await expect.poll(() => checked(first)).toBe('true')
  button('Cancel')!.click()
  await expect.poll(() => field('name')).toBeNull()
  expect(discardDialog()).toBeUndefined()
})

test('Cmd/Ctrl+S sends the invitation from inside its slideover', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const admin = mountAdmin('/admin/users', {
    cookie: await host.signIn(owner.email, owner.password),
  })
  await expect.poll(() => button('Invite')?.disabled).toBe(false)
  button('Invite')!.click()
  await expect.poll(() => field('email')).toBeTruthy()
  type('email', 'shortcut@example.test')
  const sent = host.mailer.sent.length
  const shortcut = new KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  field('email')!.dispatchEvent(shortcut)
  expect(shortcut.defaultPrevented).toBe(true)
  await expect.poll(admin.text).toContain('The invitation to shortcut@example.test is on its way.')
  expect(field('email')).toBeNull()
  await expect.poll(() => host.mailer.sent.length).toBe(sent + 1)
})
