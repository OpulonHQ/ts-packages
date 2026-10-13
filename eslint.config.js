import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

const packages = ['core', 'ui', 'admin', 'users', 'emails', 'media', 'cms']

// Package graph (TSPACK-6, ADR 0001). Server: users->emails, cms->media, all->core.
// Browser: ui <- admin <- module admin entries (src/admin/**).
const serverDeps = {
  core: [],
  ui: [],
  admin: ['core', 'ui'],
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
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '.packed/',
      'fixtures/host/public/',
      '**/.nuxt/',
      '**/.output/',
      '**/.wrangler/',
      '.verify/',
      '.claude/',
      '.vitest/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // Screens are named by their route; kit components by their canonical specifier.
      'vue/multi-word-component-names': 'off',
      // Type-based props: `undefined` is the default of an optional prop; TypeScript checks names.
      'vue/require-default-prop': 'off',
      'no-undef': 'off',
    },
  },
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
  {
    // Core's withTransaction owns the afterCommit queue, so it is the only way to open one.
    ignores: ['packages/core/src/background.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression > MemberExpression.callee[property.name='withTransaction']",
          message: 'Open transactions with withTransaction from @opulonjs/core (afterCommit).',
        },
      ],
    },
  },
  prettier,
)
