import { defineAdminModule } from '@opulonjs/admin'
import { mediaAuditActions, mediaPermissions } from '../api.ts'

/**
 * The media picker for forms (cms `media` fields): `v-model` holds a media item id or null.
 * Props: `label`, `accept` (`'image' | 'pdf'`), `disabled`. Needs `media.view`; uploads from the
 * picker need `media.upload`. Use it inside a `createAdmin` app (it calls the media API).
 */
export { default as MediaPicker } from './MediaPicker.vue'

/** The media module's admin side: the library screen under Content. */
export const mediaAdmin = () =>
  defineAdminModule({
    id: 'media',
    permissions: mediaPermissions,
    auditActions: mediaAuditActions,
    routes: [
      {
        name: 'media.library',
        path: '/media',
        permission: 'media.view',
        component: () => import('./LibraryScreen.vue'),
      },
    ],
    nav: [
      { label: 'nav.library', route: 'media.library', icon: 'i-lucide-images', group: 'content' },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
