import { defineAdminModule, type Lazy } from '@opulonjs/admin'
import { type Component, defineComponent, h } from 'vue'
import { usersAuditActions, usersPermissions } from '../api.ts'

export interface UsersAdminOptions {
  /**
   * Shows the Cloudflare Turnstile widget on the sign-in and forgotten-password screens. Set it
   * together with `USERS_TURNSTILE` on the server, which then refuses a request without a token.
   */
  readonly turnstile?: { readonly siteKey: string } | undefined
}

/**
 * The users module's admin side and the admin's auth provider: the public sign-in, forgotten
 * password, password reset and invitation screens, sign-out, the Users and Roles screens and
 * each user's own account (admin language).
 */
export const usersAdmin = (options: UsersAdminOptions = {}) => {
  const siteKey = options.turnstile?.siteKey
  const guarded = (load: Lazy<Component>): Lazy<Component> =>
    siteKey === undefined
      ? load
      : async () => {
          const { default: screen } = await load()
          return {
            default: defineComponent(() => () => h(screen, { turnstileSiteKey: siteKey })),
          }
        }
  return defineAdminModule({
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
      confirmPassword: async ({ apiPrefix, fetch, password }) => {
        const response = await fetch(
          new URL(`${apiPrefix}/users/password-confirmation`, location.origin),
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password }),
          },
        )
        if (response.ok) return 'confirmed'
        if (response.status === 403) return 'wrong'
        if (response.status === 429) return 'tooMany'
        throw new Error(`confirming the password answered ${response.status}`)
      },
      accountRoute: 'users.account',
      setLocale: async ({ apiPrefix, fetch, userId, locale }) => {
        const url = `${apiPrefix}/users/users/${encodeURIComponent(userId)}/locale`
        const response = await fetch(new URL(url, location.origin), {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale }),
        })
        if (!response.ok) throw new Error(`setting the locale answered ${response.status}`)
      },
    },
    routes: [
      {
        name: 'users.signIn',
        path: '/sign-in',
        public: true,
        component: guarded(() => import('./SignInScreen.vue')),
      },
      {
        name: 'users.forgotPassword',
        path: '/forgot-password',
        public: true,
        component: guarded(() => import('./ForgotPasswordScreen.vue')),
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
        nav: 'users.users',
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
    ],
    messages: {
      en: () => import('./messages/en.ts'),
      sk: () => import('./messages/sk.ts'),
      it: () => import('./messages/it.ts'),
    },
  })
}
