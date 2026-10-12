import { composeServer } from '../../src/index.ts'
import { cms, media } from './modules.ts'

// Listed before its dependency on purpose: migrate must follow dependsOn, not list order.
export const server = composeServer({ modules: [cms, media] })
