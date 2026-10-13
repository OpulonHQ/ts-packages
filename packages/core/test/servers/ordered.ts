import { composeServer } from '../../src/index.ts'
import { pages, files } from './modules.ts'

// Listed before its dependency on purpose: migrate must follow dependsOn, not list order.
export const server = composeServer({ modules: [pages, files] })
