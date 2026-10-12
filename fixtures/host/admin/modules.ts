import { mediaAdmin } from '@opulonjs/media/admin'
import { demoAdmin } from '../modules/demo/admin.ts'

// The host's admin module list. Every id must also be a server module (server/opulon.ts);
// `pnpm pack:check` compares the two lists. Server-only modules are allowed.
export const adminModules = [mediaAdmin(), demoAdmin]
