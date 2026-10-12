import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { opulonUi } from './packages/ui/src/vite.ts'

// In-repo, packages resolve each other to src through the @opulonjs/source export condition.
const source = '@opulonjs/source'
const resolve = { conditions: [source, 'module', 'browser', 'development|production'] }
const ssr = { resolve: { conditions: [source, 'module', 'node', 'development|production'] } }
const globalSetup = ['test/postgres/global-setup.ts']
// Browser-side tests (the admin shell mounted in happy-dom, anything importing ui/admin) get
// Nuxt UI and the offline icons as `opulonAdmin()` adds them. The preset is assembled from
// source here because a bare package import in this config would load the package's dist.
const adminTests = [
  'fixtures/host/test/{shell,packages,email-log,email-templates}.test.ts',
  'packages/{ui,admin}/test/**/*.test.ts',
  'fixtures/host/test/media/admin.test.ts',
  'fixtures/host/test/cms/admin.test.ts',
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
            ],
          }),
        ],
        resolve,
        ssr,
        test: { name: 'admin', include: adminTests, environment: 'happy-dom', globalSetup },
      },
    ],
  },
})
