import { defineAdminModule } from '@opulonjs/admin'
import { demoPermissions } from './api.ts'

/**
 * The demo module's admin side: a notes screen and dashboard widget through its own API group, and a
 * screen showing the UI kit's fields and table.
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
    {
      name: 'demo.kit',
      path: '/demo/kit',
      permission: 'demo.notes.view',
      component: () => import('./admin/KitScreen.vue'),
    },
  ],
  nav: [
    { label: 'nav.notes', route: 'demo.notes', icon: 'i-lucide-notebook', group: 'content' },
    { label: 'nav.kit', route: 'demo.kit', icon: 'i-lucide-form-input', group: 'content' },
  ],
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
