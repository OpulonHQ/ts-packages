import type { Redirect } from '@opulonjs/cms/api'
import { beforeEach, expect } from 'vitest'
import { test as adminTest } from '../admin-scope.ts'
import { useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
const cmsHost = useCmsHost()
beforeEach(() => cmsHost.query('delete from cms.redirect'))
const test = adminTest.extend<{ host: typeof cmsHost }>({
  host: async ({ scope }, use) => use(scope.host(cmsHost)),
})

const buttons = (label: string) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label)
const button = (label: string) => buttons(label)[0]
const row = (text: string) =>
  [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(text)) as
    HTMLElement | undefined
const type = (name: string, value: string) => {
  const field = document.querySelector<HTMLInputElement>(
    `[name="${name}"] input, input[name="${name}"]`,
  )!
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const stored = async (host: typeof cmsHost) =>
  (await host.call<{ rows: ReadonlyArray<Redirect> }>('GET', '/redirects')).body.rows

test('editors list, create, edit and delete redirects', async ({ host, scope }) => {
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/old-team', to: '/team', status: 301 },
  })
  const text = scope.mount('/admin/cms/redirects', { fetch: host.fetch })
  await scope.poll(() => row('/old-team')).toBeDefined()
  expect(row('/old-team')!.textContent).toContain('/team')
  expect(document.querySelector('nav')?.textContent).toContain('Presmerovania')

  button('Nové presmerovanie')!.click()
  await scope.poll(() => document.querySelector('[name="from"]')).toBeTruthy()
  type('from', '/blog/hello')
  type('to', '/news/hello')
  button('Uložiť')!.click()
  await scope.poll(text).toContain('Presmerovanie uložené.')
  await scope.poll(() => row('/blog/hello')).toBeDefined()
  expect((await stored(host)).map((r) => `${r.from} -> ${r.to}`).sort()).toEqual([
    '/blog/hello -> /news/hello',
    '/old-team -> /team',
  ])

  row('/old-team')!.click()
  await scope.poll(() => button('Vymazať')).toBeDefined()
  type('to', '/our-team')
  button('Uložiť')!.click()
  await scope
    .poll(async () => (await stored(host)).find((r) => r.from === '/old-team')?.to)
    .toBe('/our-team')

  row('/old-team')!.click()
  await scope.poll(() => button('Vymazať')).toBeDefined()
  button('Vymazať')!.click()
  await scope.poll(() => buttons('Vymazať').length).toBe(2)
  // The dialog's confirm button is the last "Vymazať".
  buttons('Vymazať').at(-1)!.click()
  await scope.poll(text).toContain('Presmerovanie vymazané.')
  expect((await stored(host)).map((r) => r.from)).toEqual(['/blog/hello'])
})

test('a server refusal shows its reason', async ({ host, scope }) => {
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/a', to: '/b', status: 301 },
  })
  const text = scope.mount('/admin/cms/redirects', { fetch: host.fetch })
  await scope.poll(() => button('Nové presmerovanie')).toBeDefined()
  button('Nové presmerovanie')!.click()
  await scope.poll(() => document.querySelector('[name="from"]')).toBeTruthy()
  type('from', '/b')
  type('to', '/a')
  button('Uložiť')!.click()
  await scope.poll(text).toContain('would loop back')
})

test('a CSV import reports what it did, row by row', async ({ host, scope }) => {
  const text = scope.mount('/admin/cms/redirects', { fetch: host.fetch })
  await scope.poll(() => button('Importovať CSV')).toBeDefined()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const csv = new File(['from,to\n/wp/about/,/about\nbroken,/x\n'], 'redirects.csv', {
    type: 'text/csv',
  })
  Object.defineProperty(input, 'files', { value: [csv], configurable: true })
  input.dispatchEvent(new Event('change'))
  await scope.poll(text).toContain('Import dokončený: vytvorené 1, preskočené 0, s chybou 1.')
  expect(text()).toContain('Riadok 3: "broken" is not a path')
  await scope.poll(() => row('/wp/about')).toBeDefined()
})
