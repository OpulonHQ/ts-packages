import { staffAccess } from '@opulonjs/users/server'
import { server } from './opulon.ts'

export const staff = staffAccess(server, {
  database: (env: { readonly HYPERDRIVE: { readonly connectionString: string } }) => env.HYPERDRIVE,
})
