import { defineAdminModule } from '@opulonjs/admin'
import { usersAuditActions, usersPermissions } from '../api.ts'

/**
 * The users module's admin side and the admin's auth provider: the public sign-in, forgotten
 * password, password reset and invitation screens, sign-out, the Users and Roles screens and
 * each user's own account (admin language).
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
      {
        name: 'users.users',
        path: '/users',
        permission: 'users.manage',
        component: () => import('./UsersScreen.vue'),
      },
      {
        name: 'users.user',
        path: '/users/:id',
        permission: 'users.manage',
        component: () => import('./UserScreen.vue'),
      },
      {
        name: 'users.roles',
        path: '/roles',
        permission: 'users.roles.manage',
        component: () => import('./RolesScreen.vue'),
      },
      {
        name: 'users.account',
        path: '/account',
        signedIn: true,
        component: () => import('./AccountScreen.vue'),
      },
    ],
    nav: [
      { label: 'nav.users', route: 'users.users', icon: 'i-lucide-users', group: 'users' },
      { label: 'nav.roles', route: 'users.roles', icon: 'i-lucide-shield', group: 'users' },
      {
        label: 'nav.account',
        route: 'users.account',
        icon: 'i-lucide-circle-user',
        group: 'users',
      },
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
    },
  })
