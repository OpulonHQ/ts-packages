import { defineAdminModule } from '@opulonjs/admin'
import { demoPermissions } from './api.ts'

/**
 * The demo module's admin side: a notes screen and dashboard widget through its own API group.
 */
export const demoAdmin = defineAdminModule({
  id: 'demo',
  permissions: demoPermissions,
  routes: [
    {
      name: 'demo.notes',
      path: '/demo/notes',
      permission: 'demo.notes.view',
      component: () => import('./admin/NotesScreen.vue'),
    },
  ],
  nav: [{ label: 'nav.notes', route: 'demo.notes', icon: 'i-lucide-notebook', group: 'content' }],
  widgets: [
    {
      name: 'notes',
      permission: 'demo.notes.view',
      component: () => import('./admin/NotesWidget.vue'),
    },
  ],
  messages: {
    en: () => import('./admin/messages/en.ts'),
    sk: () => import('./admin/messages/sk.ts'),
  },
})
