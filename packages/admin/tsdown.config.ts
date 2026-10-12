import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts'],
  format: 'esm',
  plugins: [vue({ isProduction: true })],
  dts: { vue: true },
  // The UI kit stays one import away, so a host alias on a kit specifier reaches the shell too.
  external: [/^@opulonjs\/ui/, /^@tanstack\//, /^@tiptap\//, /^virtual:/],
})
