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
const cover = () =>
  [...document.querySelectorAll('form p')].find((p) => p.textContent?.trim() === 'Obálka')
    ?.parentElement
const locked = () => cover()?.closest('fieldset[disabled]') != null
const uploadButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.trim() === 'Nahrať',
  )
const storedCover = async (id: string) =>
  (await host.call<Item>('GET', `/items/${id}`)).body.draft.data.cover

const post = async (data: Record<string, unknown>) => {
  const created = (
    await host.call<Item>('POST', '/collections/posts/items', { body: { locales: {}, data } })
  ).body
  return (await host.call<Item>('POST', `/items/${created.id}/publish?version=${created.version}`))
    .body
}

/**
 * Mounts the item editor with the picker's upload and the first request matching `held` (a
 * `METHOD /last-path-segment`) both waiting on gates.
 */
const editor = (path: string, held: string) => {
  const uploadHeld = admin.gate()
  const actionHeld = admin.gate()
  const state = { uploaded: undefined as string | undefined, holding: false }
  const fetch: typeof host.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await host.fetch(request)
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === '/api/media/items') {
      state.uploaded = ((await response.clone().json()) as { id: string }).id
      await uploadHeld.promise
    } else if (`${request.method} /${pathname.split('/').pop()}` === held && !state.holding) {
      state.holding = true
      await actionHeld.promise
    }
    return response
  }
  const text = admin.mount(path, { fetch })
  const startUpload = async (filename: string) => {
    await expect.poll(() => cover()?.querySelector('button')).toBeTruthy()
    cover()!.querySelector('button')!.click()
    await expect
      .poll(() => document.querySelector('[role="dialog"] input[type="file"]'))
      .toBeTruthy()
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!
    Object.defineProperty(input, 'files', {
      value: [new File([files.png(40, 30).slice()], filename, { type: 'image/png' })],
      configurable: true,
    })
    input.dispatchEvent(new Event('change'))
    await expect.poll(() => state.uploaded).toBeTruthy()
    expect(uploadButton()?.disabled).toBe(true)
  }
  // The picker's dialog stays open so its Upload button shows when the picker has the upload.
  const finishUploadWhileLocked = async (filename: string) => {
    await expect.poll(() => state.holding).toBe(true)
    expect(locked()).toBe(true)
    uploadHeld.resolve()
    await expect.poll(() => uploadButton()?.disabled ?? 'dialog closed').toBe(false)
    expect(locked()).toBe(true)
    expect(cover()?.textContent).not.toContain(filename)
  }
  return { text, state, startUpload, finishUploadWhileLocked, release: actionHeld.resolve }
}

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
  const published = await post(earlier ? { title, cover: earlier } : { title })
  if (restoring)
    await host.call('PUT', `/items/${published.id}/draft?version=${published.version}`, {
      body: { locales: {}, data: { title } },
    })
  const filename = `cover-${crypto.randomUUID()}.png`
  const { text, state, startUpload, finishUploadWhileLocked, release } = editor(
    `/admin/cms/items/${published.id}`,
    c.held,
  )
  if (restoring) {
    await expect.poll(() => button('Zobraziť revíziu')).toBeTruthy()
    button('Zobraziť revíziu')!.click()
    await expect.poll(() => button('Obnoviť do konceptu')).toBeTruthy()
  }

  await startUpload(filename)
  button(c.action)!.click()
  if (restoring) {
    const confirm = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent?.trim() === c.action,
      )
    await expect.poll(confirm).toBeTruthy()
    confirm()!.click()
  }
  await finishUploadWhileLocked(filename)
  release()

  await expect.poll(text).toContain(c.done)
  await expect.poll(() => cover()?.textContent).toContain(filename)
  expect(cover()?.textContent).not.toContain('earlier-cover.png')
  expect(await storedCover(published.id)).toBe(earlier)
  button('Uložiť koncept')!.click()
  await expect.poll(() => storedCover(published.id)).toBe(state.uploaded)
})

test('an upload held while one item saves is dropped when the editor moves to another item', async () => {
  const kept = await host.upload(files.png(20, 20), 'kept-cover.png')
  const first = await post({ title: { en: 'First cover owner' } })
  const second = await post({ title: { en: 'Second cover owner' }, cover: kept })
  const filename = `cover-${crypto.randomUUID()}.png`
  const { text, startUpload, finishUploadWhileLocked, release } = editor(
    `/admin/cms/items/${first.id}`,
    'PUT /draft',
  )

  await startUpload(filename)
  button('Uložiť koncept')!.click()
  await finishUploadWhileLocked(filename)
  history.pushState(null, '', `/admin/cms/items/${second.id}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.poll(() => cover()?.textContent).toContain('kept-cover.png')
  expect(locked()).toBe(false)
  release()

  button('Uložiť koncept')!.click()
  await expect.poll(text).toContain('Koncept uložený.')
  expect(cover()?.textContent).not.toContain(filename)
  expect(await storedCover(second.id)).toBe(kept)
  expect(await storedCover(first.id)).toBeUndefined()
})
