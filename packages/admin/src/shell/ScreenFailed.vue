<script setup lang="ts">
import { UAlert } from '@opulonjs/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { failedScreenKey } from '../state.ts'

const { t } = useI18n()
const router = useRouter()
const failedScreen = inject(failedScreenKey)
// A full load: browsers keep a failed dynamic import cached for the page's lifetime. Within the
// same document only the #fragment would change, so that case reloads instead.
const retry = () => {
  if (!failedScreen?.value) return
  const { href } = router.resolve(failedScreen.value)
  const target = new URL(href, location.href)
  if (target.pathname + target.search !== location.pathname + location.search) {
    location.assign(href)
    return
  }
  history.replaceState(history.state, '', href)
  location.reload()
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
