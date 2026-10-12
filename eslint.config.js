import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

const packages = ['core', 'ui', 'admin', 'users', 'emails', 'media', 'cms']

// Package graph (TSPACK-6, ADR 0001). Server: users->emails, cms->media, all->core.
// Browser: ui <- admin <- module admin entries (src/admin/**).
const serverDeps = {
  core: [],
  ui: [],
  admin: ['ui'],
  emails: ['core'],
  media: ['core'],
  users: ['core', 'emails'],
  cms: ['core', 'media'],
}
const adminEntryDeps = ['admin', 'ui']

const nuxtUi = {
  group: ['@nuxt/ui', '@nuxt/ui/*'],
  message: '@nuxt/ui may only be imported inside @opulonjs/ui.',
}

function restrict(self, allowed, { allowNuxtUi = false } = {}) {
  const banned = packages.filter((p) => p !== self && !allowed.includes(p))
  const patterns = banned.map((p) => ({
    group: [`@opulonjs/${p}`, `@opulonjs/${p}/*`],
    message: `@opulonjs/${self} may not depend on @opulonjs/${p} (package graph, ADR 0001).`,
  }))
  if (!allowNuxtUi) patterns.push(nuxtUi)
  return { 'no-restricted-imports': ['error', { patterns }] }
}

export default defineConfig(
  { ignores: ['**/dist/', '**/node_modules/', '.packed/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { rules: { 'no-restricted-imports': ['error', { patterns: [nuxtUi] }] } },
  ...packages.flatMap((p) => [
    {
      files: [`packages/${p}/**`],
      rules: restrict(p, serverDeps[p], { allowNuxtUi: p === 'ui' }),
    },
    {
      files: [`packages/${p}/src/admin/**`],
      rules: restrict(p, [...serverDeps[p], ...adminEntryDeps]),
    },
  ]),
  prettier,
)
