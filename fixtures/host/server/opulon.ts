import { composeServer, core } from '@opulonjs/core'
import { media } from '@opulonjs/media/server'
import { demo } from '../modules/demo/server.ts'

// Must import cleanly in Node: `opulon migrate --server server/opulon.ts` loads it.
// Every module listed here is migrated into the test template database (test/postgres).
export const server = composeServer({
  modules: [core(), media({ widths: [320, 640, 1280] }), demo],
  contentLocales: ['en', 'it'],
})
