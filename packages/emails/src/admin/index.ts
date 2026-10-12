import { defineAdminModule } from '@opulonjs/admin'
import { emailsAuditActions, emailsPermissions } from '../api.ts'

/** The emails module's admin side under Settings: the template editor and the email log. */
export const emailsAdmin = () =>
  defineAdminModule({
    id: 'emails',
    permissions: emailsPermissions,
    auditActions: emailsAuditActions,
    routes: [
      {
        name: 'emails.templates',
        path: '/emails/templates',
        permission: 'emails.templates.manage',
        component: () => import('./TemplatesScreen.vue'),
      },
      {
        name: 'emails.template',
        path: '/emails/templates/:key',
        permission: 'emails.templates.manage',
        component: () => import('./TemplateEditorScreen.vue'),
      },
      {
        name: 'emails.log',
        path: '/emails/log',
        permission: 'emails.log.view',
        component: () => import('./EmailLogScreen.vue'),
      },
    ],
    nav: [
      {
        label: 'nav.templates',
        route: 'emails.templates',
        icon: 'i-lucide-mail-pen',
        group: 'settings',
      },
      { label: 'nav.log', route: 'emails.log', icon: 'i-lucide-mail', group: 'settings' },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
