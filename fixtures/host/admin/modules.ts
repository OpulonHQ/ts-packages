import { cmsAdmin } from '@opulonjs/cms/admin'
import { emailsAdmin } from '@opulonjs/emails/admin'
import { mediaAdmin } from '@opulonjs/media/admin'
import { usersAdmin } from '@opulonjs/users/admin'
import { definitions } from '../cms/definitions.ts'
import { demoAdmin } from '../modules/demo/admin.ts'

// The host's admin module list. Every id must also be a server module (server/opulon.ts);
// `pnpm pack:check` compares the two lists. Server-only modules are allowed.
export const adminModules = [
  usersAdmin(),
  demoAdmin,
  emailsAdmin(),
  mediaAdmin(),
  cmsAdmin({ definitions, widgets: { color: () => import('../cms/ColorWidget.vue') } }),
]
