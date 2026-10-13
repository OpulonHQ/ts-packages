import { createAdmin } from '@opulonjs/admin'
import { brand } from './brand.ts'
import { adminModules } from './modules.ts'

createAdmin({ brand, modules: adminModules }).mount('#app')
