import { defineAdminModule } from '@opulonjs/admin'
import { usersAuditActions, usersPermissions } from '../api.ts'

/**
 * The users module's admin side and the admin's auth provider: the public sign-in, forgotten
 * password, password reset and invitation screens, and sign-out.
 */
export const usersAdmin = () =>
  defineAdminModule({
    id: 'users',
    permissions: usersPermissions,
    auditActions: usersAuditActions,
    auth: {
      signInRoute: 'users.signIn',
      signOut: async ({ apiPrefix, fetch }) => {
        const response = await fetch(new URL(`${apiPrefix}/users/auth/sign-out`, location.origin), {
          method: 'POST',
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`sign-out answered ${response.status}`)
      },
    },
    routes: [
      {
        name: 'users.signIn',
        path: '/sign-in',
        public: true,
        component: () => import('./SignInScreen.vue'),
      },
      {
        name: 'users.forgotPassword',
        path: '/forgot-password',
        public: true,
        component: () => import('./ForgotPasswordScreen.vue'),
      },
      {
        name: 'users.resetPassword',
        path: '/reset-password',
        public: true,
        component: () => import('./ResetPasswordScreen.vue'),
      },
      {
        name: 'users.acceptInvitation',
        path: '/accept-invitation',
        public: true,
        component: () => import('./AcceptInvitationScreen.vue'),
      },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
