<script setup lang="ts">
/** An editor action's outcome; a draft conflict offers to reload, the edits stay until then. */
import { useI18n } from '@opulonjs/admin'
import { UAlert } from '@opulonjs/ui'
import type { ActionStatus } from './use-cms.ts'

defineProps<{ status: ActionStatus | undefined }>()
const emit = defineEmits<{ reload: [] }>()

const { t } = useI18n()
</script>

<template>
  <div v-if="status?.kind === 'conflict'" role="alert" class="mb-4">
    <UAlert
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('cms.conflict.title')"
      :description="t('cms.conflict.description')"
      :actions="[
        {
          label: t('cms.conflict.reload'),
          color: 'neutral',
          variant: 'outline',
          onClick: () => emit('reload'),
        },
      ]"
    />
  </div>
  <p
    v-else-if="status && status.message"
    :role="status.kind === 'error' ? 'alert' : 'status'"
    :class="status.kind === 'error' ? 'text-error' : 'text-success'"
    class="mb-4 text-sm"
  >
    {{ status.message }}
  </p>
</template>
