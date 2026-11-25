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

test.each([
  ['sign-in', '/admin/sign-in', 'sign-in'],
  ['forgotten-password', '/admin/forgot-password', 'request-password-reset'],
])(
  'the %s screen says the check did not load and loads it on Try again',
  async (_screen, path, action) => {
    const rendered: Array<string> = []
    Reflect.deleteProperty(window, 'turnstile')
    const text = lifetime.mount(path, { modules, fetch: host.browserFetch({ cookie: '' }) })
    await expect
      .poll(text)
      .toContain(
        'The check that you are human did not load. Check your connection or content blocker.',
      )
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)

    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        render: (_container: HTMLElement, options: { action: string }) => {
          rendered.push(options.action)
          return '1'
        },
        reset: () => {},
        remove: () => {},
      },
    })
    button('Try again')!.click()
    await expect.poll(() => rendered).toEqual([action])
    expect(text()).not.toContain('did not load')
  },
)
