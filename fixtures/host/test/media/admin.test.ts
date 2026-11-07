import { defineAdminModule } from '@opulonjs/admin'
import type { MediaItem } from '@opulonjs/media/api'
import { MediaPicker } from '@opulonjs/media/admin'
import { defineComponent, h, ref } from 'vue'
import { expect, test } from 'vitest'
import { adminModules } from '../../admin/modules.ts'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { files, useHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the fixture Worker.
const admin = useAdminLifetime()
const host = admin.track(useHost())

// A screen hosting the picker, as a cms form would. `core` is composed, so /me enables it.
const pickerScreen = defineAdminModule({
  id: 'core',
  routes: [
    {
      name: 'core.picker',
      path: '/picker',
      signedIn: true,
      component: async () => ({
        default: defineComponent(() => {
          const value = ref<string | null>(null)
          return () => [
            h(MediaPicker, {
              modelValue: value.value,
              'onUpdate:modelValue': (next: string | null) => (value.value = next),
              label: 'Hero image',
              accept: 'image',
            }),
            h('output', `picked:${value.value ?? 'none'}`),
          ]
        }),
      }),
    },
  ],
  messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
})

const mountAdmin = (path: string) =>
  admin.mount(path, { fetch: host.fetch, modules: [...adminModules, pickerScreen] })

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const row = (text: string) =>
  [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(text)) as
    HTMLElement | undefined
const item = async (id: string) =>
  (await host.call<MediaItem>('GET', `/api/media/items/${id}`)).body

test('the library lists media; editors set alt text per content locale', async () => {
  const lake = (await host.upload(files.png(800, 600), 'lake.png', 'image/png')).body
  await host.upload(files.pdf(), 'menu.pdf', 'application/pdf')
  const text = mountAdmin('/admin/media')
  await expect.poll(text).toContain('lake.png')
  expect(text()).toContain('menu.pdf')
  expect(document.querySelector('nav')?.textContent).toContain('Médiá')

  row('lake.png')!.click()
  await expect.poll(text).toContain('Alternatívny text')
  // One tab per content locale of the host (en, it), named in the admin locale.
  expect(text()).toMatch(/Angličtina.*Taliančina/)
  const alt = document.querySelector<HTMLInputElement>('input[name="alt.en"]')!
  alt.value = 'A lake at dawn'
  alt.dispatchEvent(new Event('input'))
  button('Uložiť')!.click()
  await expect.poll(text).toContain('Uložené.')
  expect((await item(lake.id)).alt).toEqual({ en: 'A lake at dawn' })
})

test('archiving asks first and warns that pages may still use the item', async () => {
  const old = (await host.upload(files.png(10, 10), 'old-banner.png', 'image/png')).body
  const text = mountAdmin('/admin/media')
  await expect.poll(() => row('old-banner.png')).toBeDefined()
  row('old-banner.png')!.click()
  await expect.poll(() => button('Archivovať')).toBeDefined()
  button('Archivovať')!.click()
  await expect.poll(text).toContain('stránky, ktoré ju už používajú')
  // The dialog's confirm button is the last "Archivovať".
  ;[...document.querySelectorAll('button')]
    .filter((b) => b.textContent?.trim() === 'Archivovať')
    .at(-1)!
    .click()
  await expect.poll(text).toContain('Archivované.')
  expect((await item(old.id)).archivedAt).not.toBeNull()
})

test('a rejected upload shows the server reason', async () => {
  const text = mountAdmin('/admin/media')
  await expect.poll(() => button('Nahrať')).toBeDefined()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const svg = new File([files.svg().slice()], 'logo.svg', { type: 'image/svg+xml' })
  Object.defineProperty(input, 'files', { value: [svg], configurable: true })
  input.dispatchEvent(new Event('change'))
  await expect.poll(text).toContain('Only JPEG, PNG, WebP, AVIF and GIF images and PDF files')
})

test('MediaPicker picks an active image and sets the v-model to its id', async () => {
  const photo = (await host.upload(files.jpeg(40, 30), 'pick-me.jpg', 'image/jpeg')).body
  await host.upload(files.pdf(), 'not-an-image.pdf', 'application/pdf')
  const archived = (await host.upload(files.png(5, 5), 'gone.png', 'image/png')).body
  await host.call('POST', `/api/media/items/${archived.id}/archive`)

  const text = mountAdmin('/admin/picker')
  await expect.poll(text).toContain('picked:none')
  expect(text()).toContain('Hero image')
  button('Vybrať médium')!.click()
  await expect.poll(() => row('pick-me.jpg')).toBeDefined()
  expect(row('not-an-image.pdf')).toBeUndefined()
  expect(row('gone.png')).toBeUndefined()
  row('pick-me.jpg')!.click()
  await expect.poll(text).toContain(`picked:${photo.id}`)
  expect(text()).toContain('pick-me.jpg')

  button('Odstrániť')!.click()
  await expect.poll(text).toContain('picked:none')
})

test('unsaved alt text survives Replace file and Archive; closing the details asks first', async () => {
  const photo = (await host.upload(files.png(10, 10), 'keep-alt.png', 'image/png')).body
  const text = mountAdmin('/admin/media')
  await expect.poll(() => row('keep-alt.png')).toBeDefined()
  row('keep-alt.png')!.click()
  const alt = () => document.querySelector<HTMLInputElement>('input[name="alt.en"]')
  await expect.poll(alt).toBeTruthy()
  alt()!.value = 'Typed, not saved'
  alt()!.dispatchEvent(new Event('input'))

  const replacement = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="file"]',
  )!
  Object.defineProperty(replacement, 'files', {
    value: [new File([files.png(20, 20).slice()], 'keep-alt-2.png', { type: 'image/png' })],
    configurable: true,
  })
  replacement.dispatchEvent(new Event('change'))
  await expect.poll(text).toContain('Súbor bol nahradený.')
  expect(alt()!.value).toBe('Typed, not saved')

  button('Archivovať')!.click()
  await expect.poll(text).toContain('stránky, ktoré ju už používajú')
  ;[...document.querySelectorAll('button')]
    .filter((b) => b.textContent?.trim() === 'Archivovať')
    .at(-1)!
    .click()
  await expect.poll(text).toContain('Archivované.')
  expect(alt()!.value).toBe('Typed, not saved')
  expect((await item(photo.id)).alt).toEqual({})

  const discardDialog = () =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
      d.textContent?.includes('Zahodiť neuložené zmeny?'),
    )
  document.querySelector<HTMLButtonElement>('button[data-slot="close"]')!.click()
  await expect.poll(discardDialog).toBeTruthy()
  ;[...discardDialog()!.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Zahodiť zmeny')!
    .click()
  await expect.poll(alt).toBeNull()
})
