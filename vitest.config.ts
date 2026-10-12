import { defineConfig } from 'vitest/config'

// In-repo, packages resolve each other to src through the @opulonjs/source export condition.
const source = '@opulonjs/source'

export default defineConfig({
  resolve: { conditions: [source, 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: [source, 'module', 'node', 'development|production'] } },
  test: {
    include: ['{packages,fixtures}/*/test/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
