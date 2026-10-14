<!-- @opulonjs/source @opulonjs/admin@0.0.0 src/shell/Dashboard.vue -->
<script setup lang="ts">
import { useAdmin, useI18n } from '@opulonjs/admin'
import EmptyState from '@opulonjs/ui/components/EmptyState'

const { widgets } = useAdmin()
const { t } = useI18n()
</script>

<template>
  <section :aria-label="t('admin.dashboard')">
    <p class="mb-4 text-sm text-muted">Fixture dashboard override</p>
    <div v-if="widgets.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <component :is="widget.component" v-for="widget in widgets" :key="widget.key" />
    </div>
    <EmptyState v-else :title="t('admin.dashboardEmpty')" icon="i-lucide-layout-dashboard" />
  </section>
</template>
