import { defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h, onBeforeUnmount } from 'vue'
import { afterAll, expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const admin = useAdminLifetime()
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
let ranAfterUnmount = false

test.fails('an admin that throws while unmounting fails its test', async () => {
  const text = admin.mount('/admin/stuck', {
    fetch: async () => new Response('', { status: 401 }),
    modules: [failsToUnmount],
  })
  await expect.poll(text).toContain('stuck screen')
})

test.fails('a later test is not run while that admin may still be mounted', () => {
  ranAfterUnmount = true
})

afterAll(() => expect(ranAfterUnmount).toBe(false))
