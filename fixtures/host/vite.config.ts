import { opulonAdmin } from '@opulonjs/admin/vite'
import { defineConfig } from 'vite'

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [opulonAdmin()],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
