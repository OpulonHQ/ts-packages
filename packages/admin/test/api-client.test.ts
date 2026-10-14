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
  app.provide(apiContextKey, { apiPrefix: '/api', fetch })
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
