import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// In-repo, packages resolve each other to src through the @opulonjs/source export condition.
const source = '@opulonjs/source'

export default defineConfig({
  plugins: [vue()],
  resolve: { conditions: [source, 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: [source, 'module', 'node', 'development|production'] } },
  test: {
    include: ['{packages,fixtures}/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/postgres/global-setup.ts'],
  },
})
