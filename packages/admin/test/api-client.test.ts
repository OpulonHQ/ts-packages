import { CoreGroup } from '@opulonjs/core/api'
import { createApp, defineComponent, h } from 'vue'
import { expect, onTestFinished, test, vi } from 'vitest'
import { useApiClient } from '../src/api-client.ts'
import { apiContextKey } from '../src/state.ts'

const heldFetch = () => {
  let release = () => {}
  const answered = new Promise<void>((resolve) => (release = resolve))
  const fetch = vi.fn(async () => {
    await answered
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return { fetch, release }
}

const mountReader = (
  fetch: typeof globalThis.fetch,
  seen: Array<string>,
  options?: { detached: boolean },
  confirmPassword?: () => Promise<boolean>,
) => {
  let read = () => {}
  const app = createApp(
    defineComponent(() => {
      const core = useApiClient(CoreGroup, options)
      read = () =>
        void core((client) => client.me()).then(
          () => seen.push('answer'),
          () => seen.push('failure'),
        )
      return () => h('p')
    }),
  )
  app.provide(apiContextKey, {
    apiPrefix: '/api',
    fetch,
    ...(confirmPassword && { passwordTicket: () => confirmPassword }),
  })
  const root = document.createElement('div')
  app.mount(root)
  onTestFinished(() => app.unmount())
  return { app, read: () => read() }
}

test('an answer that arrives while the component is mounted settles', async () => {
  const { fetch, release } = heldFetch()
  const seen: Array<string> = []
  const { read } = mountReader(fetch, seen)
  read()
  release()
  await expect.poll(() => seen).toEqual(['failure'])
})

test('an answer that arrives after the component unmounted never settles', async () => {
  const { fetch, release } = heldFetch()
  const seen: Array<string> = []
  const { app, read } = mountReader(fetch, seen)
  read()
  await expect.poll(() => fetch.mock.calls.length).toBe(1)
  app.unmount()
  release()
  // eslint-disable-next-line tests/no-sleep -- proves the late answer never applies
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(seen).toEqual([])
})

test('a detached runner settles after the component unmounted', async () => {
  const { fetch, release } = heldFetch()
  const seen: Array<string> = []
  const { app, read } = mountReader(fetch, seen, { detached: true })
  read()
  app.unmount()
  release()
  await expect.poll(() => seen).toEqual(['failure'])
})

const refusingOnce = () => {
  const answers = [
    Response.json({ _tag: 'PasswordConfirmationRequired' }, { status: 403 }),
    new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }),
  ]
  return vi.fn(async () => answers.shift()!)
}

test('a request refused for a password confirmation is sent again once the user confirmed', async () => {
  const fetch = refusingOnce()
  const seen: Array<string> = []
  const { read } = mountReader(fetch, seen, undefined, async () => true)
  read()
  await expect.poll(() => seen).toEqual(['failure'])
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('a request is not sent again when the user declines to confirm', async () => {
  const fetch = refusingOnce()
  const seen: Array<string> = []
  const { read } = mountReader(fetch, seen, undefined, async () => false)
  read()
  await expect.poll(() => seen).toEqual(['failure'])
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('a request is not sent again when its component unmounted before the user confirmed', async () => {
  const fetch = refusingOnce()
  const seen: Array<string> = []
  const confirmed = Promise.withResolvers<boolean>()
  const confirmPassword = vi.fn(() => confirmed.promise)
  const { app, read } = mountReader(fetch, seen, undefined, confirmPassword)
  read()
  await expect.poll(() => confirmPassword.mock.calls.length).toBe(1)
  app.unmount()
  confirmed.resolve(true)
  // eslint-disable-next-line tests/no-sleep -- proves the request is never repeated
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(seen).toEqual([])
})
