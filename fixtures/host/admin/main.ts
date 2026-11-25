import { createAdmin } from '@opulonjs/admin'
import { brand } from './brand.ts'
import { hostMessages } from './messages.ts'
import { adminModules } from './modules.ts'

createAdmin({
  brand,
  modules: adminModules,
  messages: hostMessages,
  locales: ['en', 'sk', 'it'],
  overrides: { dashboard: () => import('./overrides/Dashboard.vue') },
}).mount('#app')
