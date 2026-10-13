import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  entry: ['src/index.ts', 'src/api.ts', 'src/server/index.ts', 'src/admin/index.ts'],
  format: 'esm',
  plugins: [vue({ isProduction: true })],
  dts: { vue: true },
  // Other @opulonjs packages stay imports, so a host alias on a UI kit specifier reaches us too.
  external: [/^@opulonjs\//, /^@nuxt\//, /^virtual:/],
})
