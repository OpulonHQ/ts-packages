import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

// Modules preserved: one output file per component, so a host's Vite alias on a canonical
// `@opulonjs/ui/components/<Name>` specifier catches every import, the kit's own included.
export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts', 'src/components/**/*.vue'],
  unbundle: true,
  format: 'esm',
  plugins: [vue({ isProduction: true })],
  dts: { vue: true },
  external: [/^@nuxt\/ui/, /^@tanstack\//, /^@tiptap\//, /^@opulonjs\/ui\//, /^virtual:/],
})
