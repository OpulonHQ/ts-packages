<script setup lang="ts">
import { useCmsClient, useCmsPublicPage } from '@opulonjs/cms/site/nuxt'

// Nothing here depends on the visitor (a preview stays private anyway): cache it publicly.
useCmsPublicPage()
// `?preview=<page id>` reads the draft with the editor's session; otherwise the published page.
const props = defineProps<{ path: string; preview: string | null }>()
const cms = useCmsClient()
const { data } = await useAsyncData(`cms:${props.path}:${props.preview}`, async () => {
  const site = await cms.site()
  const page = props.preview ? await cms.previewPage(props.preview) : await cms.resolve(props.path)
  return { site, page }
})
// Nuxt's error page answers (through Nitro's error handler, past render:response).
const page = data.value?.page
if (page && 'kind' in page && page.kind === 'not_found') throw createError({ statusCode: 404 })
</script>

<template>
  <main>
    <pre>{{ JSON.stringify(data) }}</pre>
  </main>
</template>
