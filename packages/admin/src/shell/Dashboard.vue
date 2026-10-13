<script setup lang="ts">
import EmptyState from '@opulonjs/ui/components/EmptyState'
import { useI18n } from 'vue-i18n'
import { useAdmin } from '../state.ts'

const { widgets } = useAdmin()
const { t } = useI18n()
</script>

<template>
  <section :aria-label="t('admin.dashboard')">
    <div v-if="widgets.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <component :is="widget.component" v-for="widget in widgets" :key="widget.key" />
    </div>
    <EmptyState v-else :title="t('admin.dashboardEmpty')" icon="i-lucide-layout-dashboard" />
  </section>
</template>
