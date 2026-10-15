import { defineConfig } from 'vite'

export default defineConfig({
  root: 'site',
  base: '/site/',
  build: { outDir: '../public/site', emptyOutDir: true },
})
