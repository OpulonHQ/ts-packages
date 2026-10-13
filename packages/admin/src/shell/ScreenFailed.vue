<script setup lang="ts">
import { UAlert } from '@opulonjs/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { failedScreenKey } from '../state.ts'

const { t } = useI18n()
const router = useRouter()
const failedScreen = inject(failedScreenKey)
const retry = () => failedScreen?.value && router.push(failedScreen.value)
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
