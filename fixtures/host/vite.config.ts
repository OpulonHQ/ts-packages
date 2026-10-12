import { fileURLToPath } from 'node:url'
import { opulonAdmin } from '@opulonjs/admin/vite'
import { defineConfig } from 'vite'
import { brand } from './admin/brand.ts'

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [
    opulonAdmin({
      brand,
      // Package admin screens outside the root, scanned for Tailwind classes and icons.
      sources: [
        fileURLToPath(new URL('../../packages/emails/src', import.meta.url)),
        fileURLToPath(new URL('../../packages/users/src', import.meta.url)),
      ],
    }),
  ],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
