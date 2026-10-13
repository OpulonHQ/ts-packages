<script setup lang="ts">
/**
 * <PageHeader :title="t('demo.notes.title')" :description="...">
 *   <template #actions><UButton icon="i-lucide-plus" :label="..." /></template>
 * </PageHeader>
 */
import type { BreadcrumbItem } from '@nuxt/ui'
import UBreadcrumb from '@nuxt/ui/components/Breadcrumb.vue'

defineProps<{ title: string; description?: string; breadcrumbs?: BreadcrumbItem[] }>()
</script>

<template>
  <header class="mb-6">
    <UBreadcrumb v-if="breadcrumbs?.length" :items="breadcrumbs" class="mb-3" />
    <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold text-highlighted sm:text-2xl">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
