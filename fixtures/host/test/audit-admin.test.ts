import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeHost, seedUser, sqlQuery } from './support/users.ts'

const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(makeHost(() => db.url, { buildId: 'b1' }))

function mount(
  path: string,
  cookie: string,
  options: {
    apiPrefix?: `/${string}`
    failAudit?: boolean
    firstAudit?: Promise<Response>
  } = {},
) {
  const requests: string[] = []
  const fetch = host.browserFetch({ cookie })
  const prefix = options.apiPrefix ?? '/api'
  let failAudit = options.failAudit ?? false
  let firstAudit = options.firstAudit
  const text = lifetime.mount(path, {
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
  return { text, requests }
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
  const errors = document.querySelectorAll('[role="alert"]')
  expect(errors).toHaveLength(1)
  expect(errors[0]?.textContent).toContain('The audit events could not be loaded.')
  expect(errors[0]?.querySelector('button')?.textContent?.trim()).toBe('Retry')
  expect(admin.text()).not.toContain('The data could not be loaded.')
  button('Retry')!.click()
  await expect.poll(() => rows().join(' ')).toContain(user.email)
  expect(button('Retry')).toBeUndefined()
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toHaveLength(2)
})

test.each(['', '2026-01-01'])(
  'the audit log rejects a Through date beyond 9999-12-30 with From "%s" and recovers',
  async (start) => {
    const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
    const admin = mount('/admin/audit', await host.signIn(user.email, user.password))
    await expect.poll(() => rows().join(' ')).toContain(user.email)
    const initialRequests = admin.requests.filter((url) => new URL(url).pathname === '/api/audit')
    type('start', start)
    type('end', '9999-12-31')
    button('Apply filters')!.click()
    await expect
      .poll(() => document.querySelector('[role="alert"]')?.textContent?.trim())
      .toBe('Enter a Through date on or before 9999-12-30.')
    expect(button('Retry')).toBeUndefined()
    expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toEqual(
      initialRequests,
    )
    type('end', '9999-12-30')
    type('subjectId', 'missing-future-date')
    button('Apply filters')!.click()
    await expect.poll(admin.text).toContain('No audit events match.')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(button('Retry')).toBeUndefined()
    const requests = admin.requests.filter((url) => new URL(url).pathname === '/api/audit')
    expect(requests).toHaveLength(initialRequests.length + 1)
    expect(new URL(requests.at(-1)!).searchParams.get('end')).toBe('9999-12-31T00:00:00.000Z')
  },
)

test('the Through date limit has a Slovak validation message', async () => {
  const user = await seedUser(db.url, { permissions: ['core.audit.view'], locale: 'sk' })
  const admin = mount('/admin/audit', await host.signIn(user.email, user.password))
  await expect.poll(() => rows().join(' ')).toContain(user.email)
  type('end', '9999-12-31')
  button('Použiť filtre')!.click()
  await expect
    .poll(() => document.querySelector('[role="alert"]')?.textContent?.trim())
    .toBe('Zadajte dátum konca najneskôr 9999-12-30.')
  expect(button('Skúsiť znova')).toBeUndefined()
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toHaveLength(1)
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

test('audit pagination stays within the offset limit while showing the true total', async () => {
  onTestFinished(async () => {
    await sqlQuery(db.url, 'delete from core.audit_event where action = $1', ['large.note.changed'])
  })
  const user = await seedUser(db.url, { permissions: ['core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event (actor_kind, action, subject_type, subject_id, subject_label)
    select 'system', 'large.note.changed', 'note', n::text, 'Large note ' || n
    from generate_series(1, 10026) n`,
  )
  const admin = mount('/admin/audit', cookie)
  await expect.poll(() => rows()[0]).toContain('Large note 10026')
  type('module', 'large')
  button('Apply filters')!.click()
  await expect
    .poll(() => admin.requests.some((url) => new URL(url).searchParams.get('module') === 'large'))
    .toBe(true)
  await expect.poll(() => rows()[0]).toContain('Large note 10026')
  document.querySelector<HTMLButtonElement>('button[data-slot="last"]')!.click()
  await expect.poll(() => rows()[0]).toContain('Large note 26')
  expect(admin.text()).toContain('Only the newest 10025 matching events')
  expect(admin.text()).toContain('10001–10025 of 10026')
  expect(document.querySelector('[role="alert"]')).toBeNull()
  const request = admin.requests.filter((url) => new URL(url).pathname === '/api/audit').at(-1)
  expect(request && new URL(request).searchParams.get('page')).toBe('401')
})

test('the timeline labels the reachable page count and explains the history window', async () => {
  onTestFinished(async () => {
    await sqlQuery(db.url, 'delete from core.audit_event where action = $1', ['large.user.changed'])
  })
  const user = await seedUser(db.url, { permissions: ['users.manage', 'core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event (actor_kind, action, subject_type, subject_id, subject_label)
    select 'system', 'large.user.changed', 'user', $1, 'Deep snapshot ' || n
    from generate_series(1, 10011) n`,
    [user.id],
  )
  mount(`/admin/users/${user.id}`, cookie)
  const timeline = () => document.querySelector('[aria-label="Audit timeline"]')?.textContent ?? ''
  await expect.poll(timeline).toContain('Deep snapshot 10011')
  expect(timeline()).toContain('Page 1 of 1001')
  expect(timeline()).toContain('Only the newest 10010 matching events')
})
function type(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (!input) throw new Error(`Missing ${name} filter`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

test('the timeline recovers to the last remaining page after its page becomes empty', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage', 'core.audit.view'] })
  const cookie = await host.signIn(user.email, user.password)
  await sqlQuery(
    db.url,
    `insert into core.audit_event (actor_kind, action, subject_type, subject_id, subject_label)
    select 'system', 'retired.user.changed', 'user', $1, 'Surviving snapshot ' || n
    from generate_series(1, 12) n`,
    [user.id],
  )
  const admin = mount(`/admin/users/${user.id}`, cookie)
  const timeline = () => document.querySelector('[aria-label="Audit timeline"]')?.textContent ?? ''
  await expect.poll(timeline).toContain('Surviving snapshot 12')
  await sqlQuery(
    db.url,
    'delete from core.audit_event where subject_id = $1 and subject_label like $2',
    [user.id, 'Surviving snapshot %'],
  )
  button('Next events')!.click()
  await expect.poll(timeline).toContain('Signed in')
  expect(timeline()).not.toContain('No audit events match.')
  const pages = admin.requests
    .filter((url) => new URL(url).pathname === '/api/audit')
    .map((url) => new URL(url).searchParams.get('page'))
  expect(pages.slice(-2)).toEqual(['2', '1'])
})

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
  expect(document.querySelector('tbody time')?.textContent).toContain('UTC')
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
