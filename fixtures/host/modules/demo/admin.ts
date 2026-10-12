import { defineAdminModule } from '@opulonjs/admin'

/** The demo module's admin side: one screen that lists notes through its own API group. */
export const demoAdmin = defineAdminModule({
  id: 'demo',
  routes: [
    {
      name: 'demo.notes',
      path: '/demo/notes',
      permission: 'demo.notes.view',
      component: () => import('./admin/NotesScreen.vue'),
    },
  ],
  nav: [{ label: 'nav.notes', route: 'demo.notes' }],
  messages: {
    en: () => import('./admin/messages/en.ts'),
    sk: () => import('./admin/messages/sk.ts'),
  },
})
