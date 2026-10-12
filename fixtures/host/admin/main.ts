import { createAdmin } from '@opulonjs/admin'
import { adminModules } from './modules.ts'

createAdmin({ brand: { name: 'Fixture host' }, modules: adminModules }).mount('#app')
