<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { UAlert } from '@opulonjs/ui'

const { t } = useI18n()
const reload = () => location.reload()
</script>

<template>
  <UAlert
    role="alert"
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="t('cms.errors.editor')"
    :actions="[
      { label: t('cms.errors.reload'), color: 'neutral', variant: 'subtle', onClick: reload },
    ]"
  />
</template>
