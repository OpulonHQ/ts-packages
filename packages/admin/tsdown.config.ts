import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

const splitForFirstLoad = [
  'src/state.ts',
  'src/api-client.ts',
  'src/CachePurgeNotice.vue',
  'src/audit/AuditTimeline.vue',
]

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts', ...splitForFirstLoad],
  format: 'esm',
  plugins: [vue({ isProduction: true })],
  dts: { vue: true },
  // The UI kit stays one import away, so a host alias on a kit specifier reaches the shell too.
  external: [/^@opulonjs\/ui/, /^@tanstack\//, /^@tiptap\//, /^virtual:/],
})
