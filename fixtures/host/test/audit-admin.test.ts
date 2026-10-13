import { createAdmin } from '@opulonjs/admin'
import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url, { buildId: 'b1' })

function mount(
  path: string,
  cookie: string,
  options: {
    apiPrefix?: `/${string}`
    failAudit?: boolean
    firstAudit?: Promise<Response>
  } = {},
) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const requests: string[] = []
  const fetch = host.browserFetch({ cookie })
  const prefix = options.apiPrefix ?? '/api'
  let failAudit = options.failAudit ?? false
  let firstAudit = options.firstAudit
  const app = createAdmin({
    brand,
    modules: adminModules,
    buildId: 'b1',
    apiPrefix: prefix,
    fetch: (input, init) => {
      const request = new Request(input, init)
      requests.push(request.url)
      const url = new URL(request.url)
      if (url.pathname === `${prefix}/audit` && firstAudit) {
        const response = firstAudit
        firstAudit = undefined
        return response
      }
      if (url.pathname === `${prefix}/audit` && failAudit) {
        failAudit = false
        return Promise.resolve(new Response('Temporarily unavailable', { status: 503 }))
      }
      url.pathname = `/api${url.pathname.slice(prefix.length)}`
      return fetch(new Request(url, request))
    },
  })
  app.mount('#app')
  onTestFinished(() => app.unmount())
  return { text: () => document.body.textContent ?? '', requests }
}

test('Settings exposes the audit log with localized actions and user snapshot changes', async () => {
  const owner = await seedUser(db.url, { superAdmin: true, name: 'Audit owner' })
  const subject = await seedUser(db.url, { name: 'Timeline subject' })
  const cookie = await host.signIn(owner.email, owner.password)
  expect(
    (
      await host.request('PUT', `/users/users/${subject.id}/locale`, {
        cookie,
        body: { locale: 'sk' },
      })
    ).status,
  ).toBe(204)
  const admin = mount('/admin/audit', cookie)
  await expect.poll(admin.text).toContain(subject.email)
  expect(document.querySelector('nav')?.textContent).toContain('Settings')
  expect(document.querySelector('nav')?.textContent).toContain('Audit log')
  expect(admin.text()).toContain('Changed the admin language')
  expect(admin.text()).toContain('locale')
  expect(admin.text()).toContain('sk')
  expect(admin.text()).toContain('IP address')
  expect(admin.text()).toContain('User agent')
  expect(admin.requests.some((url) => new URL(url).pathname === '/api/audit')).toBe(true)
})

test('the typed core client retains a custom API prefix and localized module catalogs', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'], locale: 'sk' })
  const admin = mount('/admin/audit', await host.signIn(user.email, user.password), {
    apiPrefix: '/staff/v1',
  })
  await expect.poll(() => rows().join(' ')).toContain('Prihlásenie')
  expect(document.querySelector('nav')?.textContent).toContain('Auditný záznam')
  expect(admin.requests.some((url) => new URL(url).pathname === '/staff/v1/audit')).toBe(true)
  expect(admin.requests.some((url) => new URL(url).pathname === '/staff/v1/core/audit')).toBe(false)
})

test('the audit log recovers from a failed request with Retry', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const admin = mount('/admin/audit', await host.signIn(user.email, user.password), {
    failAudit: true,
  })
  await expect.poll(() => button('Retry')).toBeDefined()
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  button('Retry')!.click()
  await expect.poll(() => rows().join(' ')).toContain(user.email)
  expect(button('Retry')).toBeUndefined()
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toHaveLength(2)
})

test('the subject timeline recovers from a failed request with Retry', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage', 'core.audit.view'] })
  const admin = mount(`/admin/users/${user.id}`, await host.signIn(user.email, user.password), {
    failAudit: true,
  })
  const timeline = () => document.querySelector('[aria-label="Audit timeline"]')?.textContent ?? ''
  await expect.poll(timeline).toContain('The audit events could not be loaded.')
  button('Retry')!.click()
  await expect.poll(timeline).toContain('Signed in')
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toHaveLength(2)
})

test('an obsolete audit request cannot show Retry after new filters succeed', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const pending = Promise.withResolvers<Response>()
  const admin = mount('/admin/audit', await host.signIn(user.email, user.password), {
    firstAudit: pending.promise,
  })
  await expect
    .poll(() => admin.requests.filter((url) => new URL(url).pathname === '/api/audit').length)
    .toBe(1)
  type('subjectId', user.id)
  button('Apply filters')!.click()
  await expect.poll(() => rows().join(' ')).toContain(user.email)
  pending.resolve(new Response('Obsolete request failed', { status: 503 }))
  await pending.promise
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(rows().join(' ')).toContain(user.email)
  expect(button('Retry')).toBeUndefined()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)
const rows = () => [...document.querySelectorAll('tbody tr')].map((el) => el.textContent ?? '')
function type(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (!input) throw new Error(`Missing ${name} filter`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

test('audit filters whole UTC days, pages on the server and falls back to unknown action keys', async () => {
  const owner = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(owner.email, owner.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event (occurred_at, actor_kind, actor_name, action,
    subject_type, subject_id, subject_label)
    select '2026-01-02T00:00:00Z'::timestamptz + n * interval '1 second', 'system', 'Archive job',
    'retired.note.changed', 'note', 'archive-' || n, 'Archive note ' || n from generate_series(1, 27) n`,
  )
  const admin = mount('/admin/audit', cookie)
  await expect.poll(admin.text).toContain('Archive note 27')
  type('module', 'retired')
  type('actor', 'Archive job')
  type('start', '2026-01-02')
  type('end', '2026-01-02')
  button('Apply filters')!.click()
  await expect.poll(() => rows().length).toBe(25)
  expect(rows()[0]).toContain('Archive note 27')
  expect(rows()[24]).toContain('Archive note 3')
  expect(rows().join(' ')).toContain('retired.note.changed')
  expect(rows().join(' ')).not.toContain('IP address')
  expect(rows().join(' ')).not.toContain('User agent')
  document.querySelector<HTMLButtonElement>('button[data-slot="next"]')!.click()
  await expect.poll(() => rows().length).toBe(2)
  expect(rows()[0]).toContain('Archive note 2')
  expect(admin.requests.some((url) => new URL(url).searchParams.get('page') === '2')).toBe(true)
  type('subjectId', 'archive-27')
  type('subjectType', 'note')
  type('subjectLabel', 'note 27')
  type('action', 'retired.note.changed')
  button('Apply filters')!.click()
  await expect.poll(() => rows()[0]).toContain('Archive note 27')
  expect(rows()).toHaveLength(1)
  type('start', '2026-01-03')
  button('Apply filters')!.click()
  await expect.poll(admin.text).toContain('Enter a valid date range')
  type('start', '2026-01-02')
  type('subjectId', 'missing')
  button('Apply filters')!.click()
  await expect.poll(admin.text).toContain('No audit events match.')
})

test('UserScreen scopes and pages its timeline and refreshes after a user mutation', async () => {
  const owner = await seedUser(db.url, { superAdmin: true })
  const subject = await seedUser(db.url, { name: 'Timeline target' })
  const cookie = await host.signIn(owner.email, owner.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event
    (occurred_at, actor_kind, actor_name, action, subject_type, subject_id, subject_label)
    select '2026-01-02T00:00:00Z'::timestamptz + n * interval '1 second', 'system', 'History job',
      'retired.user.changed', 'user', $1, 'Snapshot ' || n from generate_series(1, 12) n`,
    [subject.id],
  )
  const admin = mount(`/admin/users/${subject.id}`, cookie)
  const timeline = () => document.querySelector('[aria-label="Audit timeline"]')?.textContent ?? ''
  await expect.poll(timeline).toContain('Snapshot 12')
  expect(timeline()).not.toContain(owner.email)
  expect(document.querySelectorAll('[aria-label="Audit timeline"] li')).toHaveLength(10)
  button('Next events')!.click()
  await expect.poll(timeline).toContain('Snapshot 1')
  expect(document.querySelectorAll('[aria-label="Audit timeline"] li')).toHaveLength(2)
  button('Deactivate')!.click()
  const confirm = () =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === 'Deactivate the user',
    )
  await expect.poll(confirm).toBeDefined()
  confirm()!.click()
  await expect.poll(timeline).toContain('Deactivated a user')
  expect(timeline()).toContain('Page 1 of 2')
  const urls = admin.requests.filter((url) => new URL(url).pathname === '/api/audit')
  expect(urls.length).toBeGreaterThan(2)
  for (const url of urls) {
    expect(new URL(url).searchParams.get('subjectId')).toBe(subject.id)
    expect(new URL(url).searchParams.get('subjectType')).toBe('user')
  }
})

test('a user manager without audit permission sees no timeline and makes no audit request', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage'] })
  const cookie = await host.signIn(user.email, user.password)
  const admin = mount(`/admin/users/${user.id}`, cookie)
  await expect.poll(admin.text).toContain('Save roles')
  expect(admin.text()).not.toContain('Audit timeline')
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toEqual([])
})

test('unauthorized users see no audit navigation and trigger no audit requests', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage'] })
  const cookie = await host.signIn(user.email, user.password)
  const admin = mount('/admin/audit', cookie)
  await expect.poll(() => location.pathname).toBe('/admin/')
  expect(document.querySelector('nav')?.textContent).not.toContain('Audit log')
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toEqual([])
})
