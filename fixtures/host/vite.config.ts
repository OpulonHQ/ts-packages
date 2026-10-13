import { fileURLToPath } from 'node:url'
import { opulonAdmin } from '@opulonjs/admin/vite'
import { defineConfig } from 'vite'
import { brand } from './admin/brand.ts'

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [
    opulonAdmin({
      brand,
      // Package admin screens outside the root, scanned for Tailwind classes and icons.
      sources: [
        repo('packages/emails/src'),
        repo('packages/media/src/admin'),
        repo('packages/users/src/admin'),
      ],
    }),
  ],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
