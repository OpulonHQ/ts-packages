import { defineAdminModule } from '@opulonjs/admin'
import { nuxtUiIt } from '@opulonjs/ui'
import { defineComponent, h } from 'vue'
import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { adminModules } from '../admin/modules.ts'
import { useAdminLifetime } from './admin-lifetime.ts'
import { makeHost, seedUser } from './support/users.ts'

const lifetime = useAdminLifetime()
const db = useTestDatabase()
const host = lifetime.track(makeHost(() => db.url, { buildId: 'build-1' }))

const englishOnly = defineAdminModule({
  id: 'demo',
  routes: [
    {
      name: 'demo.notes',
      path: '/demo/notes',
      signedIn: true,
      component: async () => ({ default: defineComponent(() => () => h('p', 'notes screen')) }),
    },
  ],
  nav: [{ label: 'nav.notes', route: 'demo.notes' }],
  messages: { en: async () => ({ default: { nav: { notes: 'Host notes in English' } } }) },
})
const modules = [...adminModules.filter((m) => m.id !== 'demo'), englishOnly]

const mountAs = async (
  locale: string | null,
  options: { readonly locales?: ReadonlyArray<string>; readonly defaultLocale?: string },
  path = '/admin/',
) => {
  const user = await seedUser(db.url, { name: 'Staff', locale })
  const cookie = await host.signIn(user.email, user.password)
  const text = lifetime.mount(path, { ...options, modules, fetch: host.browserFetch({ cookie }) })
  return { text, user, cookie }
}

const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) =>
    el.textContent?.includes(name),
  )
const openUserMenu = (label: string) =>
  document
    .querySelector<HTMLElement>(`[aria-label="${label}"]`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
const languages = async (userMenu: string, language: string) => {
  openUserMenu(userMenu)
  await expect.poll(() => menuItem(language)).toBeDefined()
  menuItem(language)!.click()
  await expect.poll(() => menuItem('English')).toBeDefined()
  return [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].map((el) =>
    el.textContent?.trim(),
  )
}

const italianHost = { locales: ['en', 'it'], defaultLocale: 'it' }

test('a host offering English and Italian shows the shell, a package screen and Nuxt UI in Italian', async () => {
  const admin = await mountAs(null, italianHost)
  await expect.poll(admin.text).toContain('Bacheca')
  expect(document.documentElement.lang).toBe('it')
  expect(
    document.querySelector(`[aria-label="${nuxtUiIt.messages.dashboardSidebarCollapse.collapse}"]`),
  ).not.toBeNull()
  expect(await languages('Menu utente', 'Lingua')).toEqual(['English', 'Italiano'])

  menuItem('English')!.click()
  await expect.poll(() => document.documentElement.lang).toBe('en')
  await expect.poll(admin.text).toContain('Dashboard')
  const me = await host.browserFetch({ cookie: admin.cookie })(new URL('/api/me', location.origin))
  expect(await me.json()).toMatchObject({ locale: 'en' })
})

test('the account screen offers the languages of the host', async () => {
  const admin = await mountAs('it', italianHost, '/admin/account')
  await expect.poll(admin.text).toContain('Lingua dell’amministrazione')
  const offered = [...document.querySelectorAll<HTMLElement>('fieldset button[lang]')].map(
    (el) => el.lang,
  )
  expect(offered).toEqual(['en', 'it'])
})

test('a saved language the host no longer offers falls back to the default', async () => {
  const admin = await mountAs('sk', italianHost)
  await expect.poll(admin.text).toContain('Bacheca')
  expect(document.documentElement.lang).toBe('it')
})

test('a host module with English only shows English in a language it lacks, never the key', async () => {
  const admin = await mountAs('it', italianHost)
  await expect.poll(admin.text).toContain('Bacheca')
  const nav = document.querySelector('nav')?.textContent ?? ''
  expect(nav).toContain('Host notes in English')
  expect(nav).not.toContain('demo.nav.notes')
})

test('a host that sets no languages offers English and Slovak', async () => {
  const admin = await mountAs('it', {})
  await expect.poll(admin.text).toContain('Dashboard')
  expect(document.documentElement.lang).toBe('en')
  expect(await languages('User menu', 'Language')).toEqual(['English', 'Slovenčina'])
})

test('a host offering Italian alone shows it without a language menu', async () => {
  const admin = await mountAs('en', { locales: ['it'] })
  await expect.poll(admin.text).toContain('Bacheca')
  openUserMenu('Menu utente')
  await expect.poll(() => menuItem('Esci')).toBeDefined()
  expect(menuItem('Lingua')).toBeUndefined()
})
