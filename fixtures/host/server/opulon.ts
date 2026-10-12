import { composeServer, core } from '@opulonjs/core'
import { demo } from '../modules/demo/server.ts'

// Must import cleanly in Node: `opulon migrate --server server/opulon.ts` loads it.
// Every module listed here is migrated into the test template database (test/postgres).
export const server = composeServer({ modules: [core(), demo] })
