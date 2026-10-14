import type { Redirect } from '@opulonjs/cms/api'
import { beforeEach, expect, test } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
beforeEach(() => host.query('delete from cms.redirect'))
const mountAdmin = (path: string) => admin.mount(path, { fetch: host.fetch })

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
const stored = async () =>
  (await host.call<{ rows: ReadonlyArray<Redirect> }>('GET', '/redirects')).body.rows

test('editors list, create, edit and delete redirects', async () => {
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/old-team', to: '/team', status: 301 },
  })
  const text = mountAdmin('/admin/cms/redirects')
  await expect.poll(() => row('/old-team')).toBeDefined()
  expect(row('/old-team')!.textContent).toContain('/team')
  expect(document.querySelector('nav')?.textContent).toContain('Presmerovania')

  button('Nové presmerovanie')!.click()
  await expect.poll(() => document.querySelector('[name="from"]')).toBeTruthy()
  type('from', '/blog/hello')
  type('to', '/news/hello')
  button('Uložiť')!.click()
  await expect.poll(text).toContain('Presmerovanie uložené.')
  await expect.poll(() => row('/blog/hello')).toBeDefined()
  expect((await stored()).map((r) => `${r.from} -> ${r.to}`).sort()).toEqual([
    '/blog/hello -> /news/hello',
    '/old-team -> /team',
  ])

  row('/old-team')!.click()
  await expect.poll(() => button('Vymazať')).toBeDefined()
  type('to', '/our-team')
  button('Uložiť')!.click()
  await expect
    .poll(async () => (await stored()).find((r) => r.from === '/old-team')?.to)
    .toBe('/our-team')

  row('/old-team')!.click()
  await expect.poll(() => button('Vymazať')).toBeDefined()
  button('Vymazať')!.click()
  await expect.poll(() => buttons('Vymazať').length).toBe(2)
  // The dialog's confirm button is the last "Vymazať".
  buttons('Vymazať').at(-1)!.click()
  await expect.poll(text).toContain('Presmerovanie vymazané.')
  expect((await stored()).map((r) => r.from)).toEqual(['/blog/hello'])
})

test('a server refusal shows its reason', async () => {
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/a', to: '/b', status: 301 },
  })
  const text = mountAdmin('/admin/cms/redirects')
  await expect.poll(() => button('Nové presmerovanie')).toBeDefined()
  button('Nové presmerovanie')!.click()
  await expect.poll(() => document.querySelector('[name="from"]')).toBeTruthy()
  type('from', '/b')
  type('to', '/a')
  button('Uložiť')!.click()
  await expect.poll(text).toContain('would loop back')
})

test('a CSV import reports what it did, row by row', async () => {
  const text = mountAdmin('/admin/cms/redirects')
  await expect.poll(() => button('Importovať CSV')).toBeDefined()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const csv = new File(['from,to\n/wp/about/,/about\nbroken,/x\n'], 'redirects.csv', {
    type: 'text/csv',
  })
  Object.defineProperty(input, 'files', { value: [csv], configurable: true })
  input.dispatchEvent(new Event('change'))
  await expect.poll(text).toContain('Import dokončený: vytvorené 1, preskočené 0, s chybou 1.')
  expect(text()).toContain('Riadok 3: "broken" is not a path')
  await expect.poll(() => row('/wp/about')).toBeDefined()
})
