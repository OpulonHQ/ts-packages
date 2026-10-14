import { defineAdminModule } from '@opulonjs/admin'
import { defineComponent, h, nextTick, ref, watchEffect } from 'vue'
import { beforeAll, describe, expect, test } from 'vitest'
import { useAdminLifetime } from './admin-lifetime.ts'

const later = () => new Promise((resolve) => setTimeout(resolve, 20))
const signal = ref(0)
let reactions = 0
const late = defineAdminModule({
  id: 'late',
  routes: [
    {
      name: 'late.page',
      path: '/late',
      public: true,
      component: async () => ({
        default: defineComponent(() => {
          watchEffect(() => {
            if (signal.value >= 0) reactions++
          })
          return () => h('p', 'late screen')
        }),
      }),
    },
  ],
  auth: { signInRoute: 'late.page' },
  messages: { en: async () => ({ default: {} }), sk: async () => ({ default: {} }) },
})

describe.each(['its test', 'its onTestFailed', 'beforeAll'])(
  'an admin mounted by work chained from %s',
  (from) => {
    const admin = useAdminLifetime()
    const host = admin.track({ first: later })
    let shown = false
    const mountLater = () =>
      void host.first().then(async () => {
        await later()
        const text = admin.mount('/admin/late', {
          fetch: async () => new Response('', { status: 401 }),
          modules: [late],
        })
        await expect.poll(text).toContain('late screen')
        shown = true
      })

    if (from === 'beforeAll') {
      beforeAll(mountLater)
      test('the first test starts after it settled', () => {})
    } else if (from === 'its test') {
      test('starts while its test ends', mountLater)
    } else {
      test.fails('starts after its test failed', ({ onTestFailed }) => {
        onTestFailed(mountLater)
        expect('failed').toBe('passed')
      })
    }

    test('is unmounted before the next test starts', async () => {
      expect(shown).toBe(true)
      document.body.innerHTML = '<p>next page</p>'
      history.replaceState(null, '', '/admin/next')
      window.dispatchEvent(new PopStateEvent('popstate'))
      const before = reactions
      signal.value++
      await nextTick()
      await later()
      expect(reactions, 'the admin still reacts').toBe(before)
      expect(location.pathname).toBe('/admin/next')
      expect(document.body.textContent).toBe('next page')
    })
  },
)
