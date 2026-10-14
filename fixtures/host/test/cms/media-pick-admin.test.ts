import type { Item } from '@opulonjs/cms/api'
import { expect, test } from 'vitest'
import { useAdminLifetime } from '../admin-lifetime.ts'
import { files } from '../media/helpers.ts'
import { useCmsHost } from './helpers.ts'

// Runs in the `admin` vitest project (happy-dom); the admin's fetch goes into the test Worker.
// The editor's admin locale is sk.
const admin = useAdminLifetime()
const host = admin.track(useCmsHost())
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

test.each([
  { action: 'Uložiť koncept', held: 'PUT /draft', done: 'Koncept uložený.' },
  { action: 'Zverejniť', held: 'PUT /draft', done: 'Zverejnené.' },
  { action: 'Zverejniť', held: 'POST /publish', done: 'Zverejnené.' },
  {
    action: 'Obnoviť do konceptu',
    held: 'POST /restore',
    done: 'Revízia bola obnovená do konceptu.',
  },
])('a cover upload that returns while "$action" waits on $held stays picked', async (c) => {
  const restoring = c.held === 'POST /restore'
  const title = { en: 'Cover race' }
  const earlier = restoring ? await host.upload(files.png(20, 20), 'earlier-cover.png') : undefined
  const post = (
    await host.call<Item>('POST', '/collections/posts/items', {
      body: { locales: {}, data: earlier ? { title, cover: earlier } : { title } },
    })
  ).body
  const published = (
    await host.call<Item>('POST', `/items/${post.id}/publish?version=${post.version}`)
  ).body
  if (restoring)
    await host.call('PUT', `/items/${post.id}/draft?version=${published.version}`, {
      body: { locales: {}, data: { title } },
    })
  const filename = `cover-${crypto.randomUUID()}.png`
  const uploadHeld = admin.gate()
  const actionHeld = admin.gate()
  let uploaded: string | undefined
  let uploadReturned = false
  let holding = false
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === '/api/media/items') {
      uploaded = ((await response.clone().json()) as { id: string }).id
      await uploadHeld.promise
      uploadReturned = true
    } else if (`${request.method} /${pathname.split('/').pop()}` === c.held && !holding) {
      holding = true
      await actionHeld.promise
    }
    return response
  }
  const text = admin.mount(`/admin/cms/items/${post.id}`, { fetch })
  const cover = () =>
    [...document.querySelectorAll('form p')].find((p) => p.textContent?.trim() === 'Obálka')
      ?.parentElement
  await expect.poll(() => cover()?.querySelector('button')).toBeTruthy()
  if (restoring) {
    await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
    button('Zobraziť revíziu')!.click()
    await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  }

  cover()!.querySelector('button')!.click()
  await expect.poll(() => document.querySelector('[role="dialog"] input[type="file"]')).toBeTruthy()
  const picker = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!
  Object.defineProperty(picker, 'files', {
    value: [new File([files.png(40, 30).slice()], filename, { type: 'image/png' })],
    configurable: true,
  })
  picker.dispatchEvent(new Event('change'))
  await expect.poll(() => uploaded).toBeTruthy()
  document
    .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Zatvoriť"]')!
    .click()
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()

  button(c.action)!.click()
  if (restoring) {
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy()
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === c.action)!
      .click()
  }
  await expect.poll(() => holding).toBe(true)
  uploadHeld.resolve()
  await expect.poll(() => uploadReturned).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 30))
  actionHeld.resolve()
  await expect.poll(text).toContain(c.done)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(cover()?.textContent).toContain(filename)
  expect(cover()?.textContent).not.toContain('earlier-cover.png')
  expect((await host.call<Item>('GET', `/items/${post.id}`)).body.draft.data.cover).toBe(earlier)

  button('Uložiť koncept')!.click()
  await expect
    .poll(async () => (await host.call<Item>('GET', `/items/${post.id}`)).body.draft.data.cover)
    .toBe(uploaded)
})
