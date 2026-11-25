<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { UAlert, UButton } from '@opulonjs/ui'
import Turnstile from '@opulonjs/ui/components/Turnstile'
import { useTemplateRef } from 'vue'

defineProps<{ siteKey: string; action: string }>()
const token = defineModel<string | undefined>()
const { t } = useI18n()
const widget = useTemplateRef('widget')

defineExpose({ reset: () => widget.value?.reset() })
</script>

<template>
  <Turnstile ref="widget" v-model="token" :site-key="siteKey" :action="action">
    <template #unavailable="{ retry }">
      <div class="space-y-2">
        <UAlert
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="t('users.errors.turnstileUnavailable')"
        />
        <UButton
          block
          color="neutral"
          variant="outline"
          :label="t('users.errors.turnstileRetry')"
          @click="retry"
        />
      </div>
    </template>
  </Turnstile>
</template>
