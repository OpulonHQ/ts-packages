import { createAdmin } from '@opulonjs/admin'
import { brand } from './brand.ts'
import { adminModules } from './modules.ts'

createAdmin({
  brand,
  modules: adminModules,
  overrides: { dashboard: () => import('./overrides/Dashboard.vue') },
}).mount('#app')
