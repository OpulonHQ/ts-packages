import { createAdmin } from '../src/createAdmin.ts'
import { defineAdminModule } from '../src/module.ts'
import { defineComponent, h } from 'vue'
import { expect, test } from 'vitest'

const auth = defineAdminModule({
  id: 'auth',
  auth: { signInRoute: 'auth.signIn' },
  routes: [
    {
      name: 'auth.signIn',
      path: '/sign-in',
      public: true,
      component: async () => ({ default: defineComponent(() => () => h('p', 'sign in')) }),
    },
  ],
  messages: { en: async () => ({ default: {} }) },
})
const options = { brand: { name: 'Test' }, modules: [auth], fetch: globalThis.fetch }

test('a default language the host does not offer is refused at startup', () => {
  expect(() => createAdmin({ ...options, locales: ['it'], defaultLocale: 'sk' })).toThrow(
    'createAdmin: default locale "sk" is not one of the offered locales (it)',
  )
})

test('a default language the host offers is accepted', () => {
  expect(() =>
    createAdmin({ ...options, locales: ['it', 'sk'], defaultLocale: 'sk' }),
  ).not.toThrow()
})
