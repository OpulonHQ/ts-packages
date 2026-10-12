import { defineAdminModule } from '@opulonjs/admin'
import { demoPermissions } from './api.ts'

/**
 * The demo module's admin side: a notes screen and dashboard widget through its own API
 * group, plus the stub sign-in screen (the fixture's auth provider until users ships).
 */
export const demoAdmin = defineAdminModule({
  id: 'demo',
  permissions: demoPermissions,
  auth: { signInRoute: 'demo.signIn' },
  routes: [
    {
      name: 'demo.signIn',
      path: '/sign-in',
      public: true,
      component: () => import('./admin/SignInScreen.vue'),
    },
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
