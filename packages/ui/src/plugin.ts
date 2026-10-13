// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the virtual module types must reach every program that checks this file (admin, hosts)
/// <reference path="./env.d.ts" />
import { _api, addCollection } from '@iconify/vue'
import nuxtUi from '@nuxt/ui/vue-plugin'
import icons from 'virtual:opulon-ui-icons'
import type { App } from 'vue'

/**
 * Installs Nuxt UI and the offline Lucide bundle the `@opulonjs/ui/vite` preset builds. The
 * Iconify API is never called, so the admin works offline and under a strict CSP.
 */
export const uiPlugin = {
  install(app: App) {
    app.use(nuxtUi)
    addCollection(icons)
    _api.setFetch(async () => {
      throw new Error('@opulonjs/ui: icons are bundled offline; this one is not in the build')
    })
  },
}
