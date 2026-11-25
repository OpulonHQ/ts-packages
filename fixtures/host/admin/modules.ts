import { cmsAdmin, type CmsAdminOptions } from '@opulonjs/cms/admin'
import { emailsAdmin } from '@opulonjs/emails/admin'
import { mediaAdmin } from '@opulonjs/media/admin'
import { usersAdmin } from '@opulonjs/users/admin'
import { definitions } from '../cms/definitions.ts'
import { demoAdmin } from '../modules/demo/admin.ts'

export const cmsOptions = {
  definitions,
  widgets: { color: () => import('../cms/ColorWidget.vue') },
  preview: {
    url: ({ id, locale }) =>
      `/site/?preview=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`,
  },
} satisfies CmsAdminOptions

const turnstileSiteKey: string | undefined = import.meta.env.VITE_USERS_TURNSTILE_SITE_KEY

// The host's admin module list. Every id must also be a server module (server/opulon.ts);
// `pnpm pack:check` compares the two lists. Server-only modules are allowed.
export const adminModules = [
  usersAdmin({ turnstile: turnstileSiteKey ? { siteKey: turnstileSiteKey } : undefined }),
  demoAdmin,
  emailsAdmin(),
  mediaAdmin(),
  cmsAdmin(cmsOptions),
]
