<script setup lang="ts">
import { UAlert } from '@opulonjs/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { failedScreenKey } from '../state.ts'

const { t } = useI18n()
const router = useRouter()
const failedScreen = inject(failedScreenKey)
// A full load: browsers keep a failed dynamic import cached for the page's lifetime. Assigning
// the current URL with a #fragment only jumps within the page, so that case reloads.
const retry = () => {
  if (!failedScreen?.value) return
  const { href } = router.resolve(failedScreen.value)
  if (new URL(href, location.href).href === location.href) location.reload()
  else location.assign(href)
}
</script>

<template>
  <div role="alert" class="mx-auto max-w-md p-6">
    <UAlert
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="t('admin.screenFailed.message')"
      :actions="[
        {
          label: t('admin.screenFailed.action'),
          color: 'neutral',
          variant: 'subtle',
          onClick: retry,
        },
      ]"
    />
  </div>
</template>
