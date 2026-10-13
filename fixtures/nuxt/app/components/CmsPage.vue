<script setup lang="ts">
import { useCmsClient } from '@opulonjs/cms/site/nuxt'

// `?preview=<page id>` reads the draft with the editor's session; otherwise the published page.
const props = defineProps<{ path: string; preview: string | null }>()
const cms = useCmsClient()
const { data } = await useAsyncData(`cms:${props.path}:${props.preview}`, async () => {
  const site = await cms.site()
  const page = props.preview ? await cms.previewPage(props.preview) : await cms.resolve(props.path)
  return { site, page }
})
</script>

<template>
  <main>
    <pre>{{ JSON.stringify(data) }}</pre>
  </main>
</template>
