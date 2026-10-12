<script setup lang="ts">
import EmptyState from '@opulonjs/ui/components/EmptyState'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <EmptyState :title="t('admin.notFound')" icon="i-lucide-map-pin-off" />
</template>
