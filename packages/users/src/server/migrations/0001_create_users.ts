import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// Better Auth's tables (the shape `schema.ts` maps, text ids, snake_case) plus ours: users are
// deactivated, never deleted, so every FK restricts. Emails are stored lowercased.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table users."user" (
    id text primary key,
    name text not null,
    email text not null unique check (email = lower(email)),
    email_verified boolean not null,
    image text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deactivated_at timestamptz,
    admin_locale text
  )`
  yield* sql`create table users.session (
    id text primary key,
    expires_at timestamptz not null,
    token text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null,
    ip_address text,
    user_agent text,
    user_id text not null references users."user" (id) on delete restrict
  )`
  yield* sql`create index session_user_id on users.session (user_id)`
  yield* sql`create table users.account (
    id text primary key,
    account_id text not null,
    provider_id text not null,
    user_id text not null references users."user" (id) on delete restrict,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope text,
    password text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null
  )`
  yield* sql`create index account_user_id on users.account (user_id)`
  // Password reset tokens; Better Auth stores them hashed (storeIdentifier: 'hashed').
  yield* sql`create table users.verification (
    id text primary key,
    identifier text not null,
    value text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`
  yield* sql`create index verification_identifier on users.verification (identifier)`
  yield* sql`create table users.rate_limit (
    id text primary key,
    key text not null unique,
    count integer not null,
    last_request bigint not null
  )`

  // Roles grant permission key strings; the built-in Super admin holds every permission.
  yield* sql`create table users.role (
    id text primary key,
    name text not null unique,
    permissions text[] not null default '{}',
    built_in boolean not null default false,
    created_at timestamptz not null default now()
  )`
  yield* sql`insert into users.role (id, name, built_in) values ('super_admin', 'Super admin', true)`
  yield* sql`create table users.user_role (
    user_id text not null references users."user" (id) on delete restrict,
    role_id text not null references users.role (id) on delete restrict,
    primary key (user_id, role_id)
  )`
  yield* sql`create index user_role_role_id on users.user_role (role_id)`

  // Only the SHA-256 of the emailed token is stored. invited_by is null for the bootstrap CLI.
  yield* sql`create table users.invitation (
    id text primary key,
    email text not null check (email = lower(email)),
    role_ids text[] not null default '{}',
    token_hash text not null unique,
    invited_by text references users."user" (id) on delete restrict,
    expires_at timestamptz not null,
    accepted_at timestamptz,
    accepted_user_id text references users."user" (id) on delete restrict,
    created_at timestamptz not null default now()
  )`
  yield* sql`create index invitation_email on users.invitation (email) where accepted_at is null`
})
