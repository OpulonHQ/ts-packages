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
  admin: ['ui'],
  emails: ['core'],
  media: ['core'],
  users: ['core', 'emails'],
  cms: ['core', 'media'],
}
const adminEntryDeps = ['admin', 'ui']

// Core's withTransaction owns the afterCommit queue, so it is the only way to open one.
const ownTransactions = {
  selector: "CallExpression > MemberExpression.callee[property.name='withTransaction']",
  message: 'Open transactions with withTransaction from @opulonjs/core (afterCommit).',
}

const sleepMessage =
  'Wait for the state itself with expect.poll or vi.waitFor, or on a gate the test opens. A fixed sleep only proves something does not happen: disable this line with that reason.'

const resolvesByTimer = (promise, sourceCode) => {
  const resolve = promise.arguments[0]?.params?.[0]
  if (resolve?.type !== 'Identifier') return false
  const resolveCall = new RegExp(`\\b${resolve.name}\\b`)
  let found = false
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return
    if (node.type === 'CallExpression' && node.callee.name === 'setTimeout') {
      const callback = node.arguments[0]
      found = !!callback && resolveCall.test(sourceCode.getText(callback))
      return
    }
    for (const key of sourceCode.visitorKeys[node.type] ?? []) [node[key]].flat().forEach(visit)
  }
  visit(promise.arguments[0].body)
  return found
}

const noSleep = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const report = (node) => context.report({ node, message: sleepMessage })
    return {
      "NewExpression[callee.name='Promise']"(node) {
        if (!resolvesByTimer(node, context.sourceCode)) return
        const helper = node.parent.type === 'ArrowFunctionExpression' ? node.parent.parent : null
        if (helper?.type !== 'VariableDeclarator') return report(node)
        for (const variable of context.sourceCode.getDeclaredVariables(helper))
          for (const { identifier, init } of variable.references) if (!init) report(identifier)
      },
    }
  },
}

const nuxtUi = {
  group: ['@nuxt/ui', '@nuxt/ui/*'],
  message: '@nuxt/ui may only be imported inside @opulonjs/ui.',
}

function restrict(self, allowed, { allowNuxtUi = false, allowCoreApi = false } = {}) {
  const banned = packages.filter((p) => p !== self && !allowed.includes(p))
  const patterns = banned.map((p) => ({
    ...(p === 'core' && allowCoreApi
      ? { regex: '^@opulonjs/core(?:$|/(?!api$))' }
      : { group: [`@opulonjs/${p}`, `@opulonjs/${p}/*`] }),
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
      rules: restrict(p, serverDeps[p], { allowNuxtUi: p === 'ui', allowCoreApi: p === 'admin' }),
    },
    {
      files: [`packages/${p}/src/admin/**`],
      rules: restrict(p, [...serverDeps[p], ...adminEntryDeps]),
    },
  ]),
  {
    ignores: ['packages/core/src/background.ts'],
    rules: { 'no-restricted-syntax': ['error', ownTransactions] },
  },
  {
    files: ['fixtures/host/test/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [nuxtUi],
          paths: [
            {
              name: '@opulonjs/admin',
              importNames: ['createAdmin'],
              message:
                'Mount admins with useAdminLifetime().mount from fixtures/host/test/admin-lifetime.ts, so each test unmounts and drains them.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    plugins: { tests: { rules: { 'no-sleep': noSleep } } },
    rules: { 'tests/no-sleep': 'error' },
  },
  prettier,
)
