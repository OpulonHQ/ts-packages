import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  entry: ['src/index.ts', 'src/api.ts', 'src/server/index.ts', 'src/admin/index.ts'],
  format: 'esm',
  plugins: [vue({ isProduction: true })],
  dts: { vue: true },
  // Kit components stay imports of their canonical specifiers, so host overrides reach them.
  external: [/^@opulonjs\//, /^@tanstack\//, /^@tiptap\//, /^virtual:/],
})
