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
  await expect.poll(() => document.querySelector('[name="from"]')).toBeNull()

  row('/old-team')!.click()
  await expect.poll(() => button('Vymazať')).toBeDefined()
  button('Vymazať')!.click()
  await expect.poll(() => buttons('Vymazať').length).toBe(2)
  expect(text()).toContain('Návštevníci starej adresy sa už nedostanú na novú.')
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

const discardDialog = () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
    d.textContent?.includes('Zahodiť neuložené zmeny?'),
  )
const inDialog = (label: string) =>
  [...(discardDialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  )!
const field = (name: string) =>
  document.querySelector<HTMLInputElement>(`[name="${name}"] input, input[name="${name}"]`)

test('the redirect slideover asks before unsaved changes are lost, and closes at once without', async () => {
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/first', to: '/one', status: 301 },
  })
  await host.call('POST', '/redirects', {
    body: { locale: 'en', from: '/second', to: '/two', status: 301 },
  })
  mountAdmin('/admin/cms/redirects')
  await expect.poll(() => row('/second')).toBeDefined()

  row('/first')!.click()
  await expect.poll(() => field('to')?.value).toBe('/one')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await expect.poll(() => field('to')).toBeNull()
  expect(discardDialog()).toBeUndefined()

  row('/first')!.click()
  await expect.poll(() => field('to')?.value).toBe('/one')
  type('to', '/uno')
  row('/second')!.click()
  await expect.poll(discardDialog).toBeTruthy()
  // Drawn above the slideover: overlays at one level paint in document order, last on top.
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  expect(dialogs.indexOf(discardDialog()!)).toBe(dialogs.length - 1)
  inDialog('Pokračovať v úpravách').click()
  await expect.poll(discardDialog).toBeUndefined()
  expect(field('to')!.value).toBe('/uno')

  // An outside click asks too; Discard changes closes. The slideover listens for outside clicks
  // again a tick after the question closed, so the click repeats until the question shows.
  const askedOnOutsideClick = () => {
    if (!discardDialog())
      document
        .querySelector('[data-slot="overlay"]')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    return inDialog('Zahodiť zmeny')
  }
  await expect.poll(askedOnOutsideClick).toBeTruthy()
  inDialog('Zahodiť zmeny').click()
  await expect.poll(() => field('to')).toBeNull()
  expect((await stored()).find((r) => r.from === '/first')?.to).toBe('/one')
})

test('Cmd/Ctrl+S saves the open redirect, but not behind its delete confirmation', async () => {
  const created = (
    await host.call<Redirect>('POST', '/redirects', {
      body: { locale: 'en', from: '/keys', to: '/one', status: 301 },
    })
  ).body
  const writes: string[] = []
  const text = admin.mount('/admin/cms/redirects', {
    fetch: (input, init) => {
      const request = new Request(input, init)
      if (request.method !== 'GET') writes.push(request.method)
      return host.fetch(request)
    },
  })
  const shortcut = () => {
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    field('to')!.dispatchEvent(event)
    return event.defaultPrevented
  }
  await expect.poll(() => row('/keys')).toBeDefined()
  row('/keys')!.click()
  await expect.poll(() => field('to')?.value).toBe('/one')
  type('to', '/two')
  expect(shortcut()).toBe(true)
  await expect.poll(text).toContain('Presmerovanie uložené.')
  expect((await stored()).find((r) => r.id === created.id)?.to).toBe('/two')

  await expect.poll(() => row('/keys')?.textContent).toContain('/two')
  row('/keys')!.click()
  await expect.poll(() => field('to')?.value).toBe('/two')
  type('to', '/three')
  button('Vymazať')!.click()
  await expect.poll(() => buttons('Vymazať').length).toBe(2)
  expect(shortcut()).toBe(true)
  buttons('Vymazať').at(-1)!.click()
  await expect.poll(text).toContain('Presmerovanie vymazané.')
  expect(writes).toEqual(['PUT', 'DELETE'])
  expect(await stored()).toEqual([])
})
