import { defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h, onBeforeUnmount } from 'vue'
import { afterAll, describe, expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const failsToUnmount = defineAdminModule({
  id: 'stuck',
  routes: [
    {
      name: 'stuck.page',
      path: '/stuck',
      public: true,
      component: async () => ({
        default: defineComponent(() => {
          onBeforeUnmount(() => {
            throw new Error('unmount failed')
          })
          return () => h('p', 'stuck screen')
        }),
      }),
    },
  ],
  auth: { signInRoute: 'stuck.page' },
  messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
})

describe.each([
  ['after its test', false],
  ['by its test', true],
])('an admin that throws while unmounted %s', (_, byTest) => {
  const admin = useAdminLifetime()
  let ranAfterUnmount = false

  test.fails('fails that test', async () => {
    const text = admin.mount('/admin/stuck', {
      fetch: async () => new Response('', { status: 401 }),
      modules: [failsToUnmount],
    })
    await expect.poll(text).toContain('stuck screen')
    if (byTest) text.unmount()
  })

  test.fails('keeps later tests from running while it may still be mounted', () => {
    ranAfterUnmount = true
  })

  afterAll(() => expect(ranAfterUnmount).toBe(false))
})
