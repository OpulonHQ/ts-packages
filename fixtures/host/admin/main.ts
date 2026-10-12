import { createAdmin } from '@opulonjs/admin'
import { brand } from './brand.ts'
import { adminModules } from './modules.ts'
import { stubFetch } from '../modules/demo/admin/stub-auth.ts'

createAdmin({ brand, modules: adminModules, fetch: stubFetch }).mount('#app')
