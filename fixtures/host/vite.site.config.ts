import { defineConfig } from 'vite'

// The admin's live preview target: site/ builds into public/site, which the Worker serves.
export default defineConfig({
  root: 'site',
  base: '/site/',
  build: { outDir: '../public/site', emptyOutDir: true },
})
