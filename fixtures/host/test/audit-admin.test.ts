import { createAdmin } from '@opulonjs/admin'
import { expect, onTestFinished, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { brand } from '../admin/brand.ts'
import { adminModules } from '../admin/modules.ts'
import { makeHost, seedUser } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url, { buildId: 'b1' })

function mount(path: string, cookie: string) {
  history.replaceState(null, '', path)
  document.body.innerHTML = '<div id="app"></div>'
  const requests: string[] = []
  const fetch = host.browserFetch({ cookie })
  const app = createAdmin({
    brand,
    modules: adminModules,
    buildId: 'b1',
    fetch: (input, init) => {
      requests.push(new Request(input, init).url)
      return fetch(input, init)
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
  await host.request('PATCH', `/users/${subject.id}/locale`, { cookie, body: { locale: 'sk' } })
  const admin = mount('/admin/audit', cookie)
  await expect.poll(admin.text).toContain('Timeline subject')
  expect(document.querySelector('nav')?.textContent).toContain('Settings')
  expect(document.querySelector('nav')?.textContent).toContain('Audit log')
  expect(admin.text()).toContain('Admin locale changed')
  expect(admin.text()).toContain('locale')
  expect(admin.text()).toContain('sk')
  expect(admin.requests.some((url) => new URL(url).pathname === '/api/audit')).toBe(true)
})

test('unauthorized users see no audit navigation and trigger no audit requests', async () => {
  const user = await seedUser(db.url, { permissions: ['users.manage'] })
  const cookie = await host.signIn(user.email, user.password)
  const admin = mount('/admin/audit', cookie)
  await expect.poll(() => location.pathname).toBe('/admin/')
  expect(document.querySelector('nav')?.textContent).not.toContain('Audit log')
  expect(admin.requests.filter((url) => new URL(url).pathname === '/api/audit')).toEqual([])
})
