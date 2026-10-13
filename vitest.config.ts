import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { opulonUi } from './packages/ui/src/vite.ts'

// In-repo, packages resolve each other to src through the @opulonjs/source export condition.
const source = '@opulonjs/source'
const resolve = { conditions: [source, 'module', 'browser', 'development|production'] }
const ssr = { resolve: { conditions: [source, 'module', 'node', 'development|production'] } }
const globalSetup = ['test/postgres/global-setup.ts']
// Better Auth imports this package, whose "module" build (picked by the conditions above) uses
// directory imports Node cannot load; let Vite transform it instead.
const server = { deps: { inline: [/better-auth/, /@opentelemetry\/semantic-conventions/] } }
// Browser-side tests (the admin shell mounted in happy-dom, anything importing ui/admin) get
// Nuxt UI and the offline icons as `opulonAdmin()` adds them. The preset is assembled from
// source here because a bare package import in this config would load the package's dist.
const adminTests = [
  'fixtures/host/test/{shell,packages,email-log,email-templates,users-admin,audit-admin,admin-scope}.test.ts',
  'packages/{ui,admin}/test/**/*.test.ts',
  'fixtures/host/test/media/admin.test.ts',
  'fixtures/host/test/cms/admin.test.ts',
  'fixtures/host/test/cms/redirects-admin.test.ts',
  'fixtures/host/test/cms/content-admin.test.ts',
  'fixtures/host/test/cms/reference-paging-admin.test.ts',
  'fixtures/host/test/cms/cms-sections.test.ts',
]

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [vue()],
        resolve,
        ssr,
        test: {
          name: 'server',
          include: ['{packages,fixtures}/*/test/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: adminTests,
          globalSetup,
          server,
        },
      },
      {
        plugins: [
          vue(),
          ...opulonUi({
            sources: [
              'packages/admin/src',
              'packages/emails/src',
              'packages/media/src/admin',
              'packages/cms/src/admin',
              'packages/users/src/admin',
            ],
          }),
        ],
        resolve,
        ssr,
        test: {
          name: 'admin',
          include: adminTests,
          environment: './test/happy-dom-server.ts',
          expect: { poll: { timeout: 5000 } },
          testTimeout: 15_000,
          globalSetup,
          server,
        },
      },
    ],
  },
})
