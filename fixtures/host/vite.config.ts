import { opulonAdmin } from '@opulonjs/admin/vite'
import { defineConfig } from 'vite'
import { brand } from './admin/brand.ts'

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [opulonAdmin({ brand })],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
