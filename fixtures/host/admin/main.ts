import { createAdmin } from '@opulonjs/admin'
import { brand } from './brand.ts'
import { adminModules } from './modules.ts'
import Dashboard from './overrides/Dashboard.vue'

createAdmin({ brand, modules: adminModules, overrides: { dashboard: Dashboard } }).mount('#app')
