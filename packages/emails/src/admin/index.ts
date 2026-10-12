import { defineAdminModule } from '@opulonjs/admin'
import { emailsPermissions } from '../api.ts'

/** The emails module's admin side: the email log under Settings. */
export const emailsAdmin = () =>
  defineAdminModule({
    id: 'emails',
    permissions: emailsPermissions,
    routes: [
      {
        name: 'emails.log',
        path: '/emails/log',
        permission: 'emails.log.view',
        component: () => import('./EmailLogScreen.vue'),
      },
    ],
    nav: [{ label: 'nav.log', route: 'emails.log', icon: 'i-lucide-mail', group: 'settings' }],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
