import { opulonAdmin } from '@opulonjs/admin/vite'
import { defineConfig } from 'vite'
import { brand } from './admin/brand.ts'
import { components } from './admin/override-components.ts'

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [
    // The @opulonjs packages' admin screens are found from package.json; no sources needed.
    opulonAdmin({ brand, overrides: { components } }),
  ],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
