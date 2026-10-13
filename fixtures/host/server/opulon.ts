import { cms } from '@opulonjs/cms/server'
import { composeServer, core } from '@opulonjs/core'
import { emails } from '@opulonjs/emails/server'
import { media } from '@opulonjs/media/server'
import { users } from '@opulonjs/users/server'
import { definitions } from '../cms/definitions.ts'
import { demo } from '../modules/demo/server.ts'

// Must import cleanly in Node: `opulon migrate --server server/opulon.ts` loads it.
// Every module listed here is migrated into the test template database (test/postgres).
export const server = composeServer({
  modules: [
    core(),
    emails({ from: 'Fixture host <noreply@example.test>', brand: { name: 'Fixture host' } }),
    users(),
    media({ widths: [320, 640, 1280] }),
    cms({ definitions }),
    demo,
  ],
  contentLocales: ['en', 'it'],
})
