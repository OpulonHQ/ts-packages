import { opulonAdmin } from '@opulonjs/admin/vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { brand } from './admin/brand.ts'

/** An installed package's admin entry directory, scanned for Tailwind classes and icons. */
const adminSources = (specifier: string) => dirname(fileURLToPath(import.meta.resolve(specifier)))

// The admin SPA: admin/ builds into public/admin, which the Worker serves as static assets.
export default defineConfig({
  root: 'admin',
  plugins: [opulonAdmin({ brand, sources: [adminSources('@opulonjs/media/admin')] })],
  build: { outDir: '../public/admin', emptyOutDir: true },
})
