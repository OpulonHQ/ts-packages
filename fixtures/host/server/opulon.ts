import { composeServer } from '@opulonjs/core'
import { demo } from '../modules/demo/server.ts'

// Must import cleanly in Node: `opulon migrate --server server/opulon.ts` loads it.
export const server = composeServer({ modules: [demo] })
