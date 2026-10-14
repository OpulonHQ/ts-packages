import { defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h, nextTick, onBeforeUnmount, ref, watchEffect } from 'vue'
import { afterAll, describe, expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const signal = ref(0)
let reactions = 0
const failsToUnmount = defineAdminModule({
  id: 'stuck',
  routes: [
    {
      name: 'stuck.page',
      path: '/stuck',
      public: true,
      component: async () => ({
        default: defineComponent(() => {
          watchEffect(() => {
            if (signal.value >= 0) reactions++
          })
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

  afterAll(async () => {
    expect(ranAfterUnmount).toBe(false)
    const before = reactions
    signal.value++
    await nextTick()
    expect(reactions, 'the admin still reacts after its unmount threw').toBe(before)
  })
})
