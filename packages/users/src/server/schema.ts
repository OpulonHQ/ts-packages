import type { BetterAuthOptions } from 'better-auth'

/**
 * Better Auth's tables in the `users` schema, with snake_case columns like every other package.
 * Migration 0001 creates exactly this shape; keep both in sync.
 */
export const tables = {
  user: {
    modelName: 'user',
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
  session: {
    modelName: 'session',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
    },
  },
  account: {
    modelName: 'account',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verification',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
} satisfies Pick<BetterAuthOptions, 'user' | 'session' | 'account' | 'verification'>

/** Better Auth's rate limit table (database storage, shared by every isolate). */
export const rateLimitTable = {
  modelName: 'rate_limit',
  fields: { lastRequest: 'last_request' },
} as const
