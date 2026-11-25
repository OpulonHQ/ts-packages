import { usersAdmin } from '@opulonjs/users/admin'
import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { adminModules } from '../admin/modules.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { dummy } from './support/turnstile.ts'
import { makeHost } from './support/users.ts'

const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(makeHost(() => db.url))
const modules = [
  usersAdmin({ turnstile: { siteKey: dummy.siteKey } }),
  ...adminModules.filter((m) => m.id !== 'users'),
]

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

const didNotLoad =
  'The check that you are human did not load. Check your connection or content blocker.'
const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!

test('both screens say the check did not load, and Try again loads it', async () => {
  const fetch = host.browserFetch({ cookie: '' })
  const signIn = lifetime.mount('/admin/sign-in', { modules, fetch })
  await expect.poll(signIn).toContain(didNotLoad)
  expect(document.querySelector('[role="alert"]')!.textContent).toContain(didNotLoad)
  expect(submit().disabled).toBe(true)
  signIn.unmount()

  const forgot = lifetime.mount('/admin/forgot-password', { modules, fetch })
  await expect.poll(forgot).toContain(didNotLoad)
  expect(submit().disabled).toBe(true)
  button('Try again')!.click()
  await expect.poll(forgot).toContain(didNotLoad)

  const rendered: Array<string> = []
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    value: {
      render: (_container: HTMLElement, options: { action: string }) => {
        rendered.push(options.action)
        return String(rendered.length)
      },
      reset: () => {},
      remove: () => {},
    },
  })
  button('Try again')!.click()
  await expect.poll(() => rendered).toEqual(['request-password-reset'])
  expect(forgot()).not.toContain(didNotLoad)
})
