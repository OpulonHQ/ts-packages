import { composeServer, core } from '@opulonjs/core'
import { emails } from '@opulonjs/emails/server'
import { demo } from '../modules/demo/server.ts'

// Must import cleanly in Node: `opulon migrate --server server/opulon.ts` loads it.
// Every module listed here is migrated into the test template database (test/postgres).
export const server = composeServer({
  modules: [
    core(),
    emails({ from: 'Fixture host <noreply@example.test>', brand: { name: 'Fixture host' } }),
    demo,
  ],
})
