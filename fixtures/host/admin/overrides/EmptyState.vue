<!-- @opulonjs/source @opulonjs/ui@0.0.0 src/components/EmptyState.vue -->
<script setup lang="ts">
import { UIcon } from '@opulonjs/ui'

withDefaults(defineProps<{ title: string; description?: string; icon?: string }>(), {
  icon: 'i-lucide-inbox',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
      <UIcon :name="icon" class="size-6 text-dimmed" aria-hidden="true" />
    </div>
    <div class="max-w-sm">
      <p class="font-medium text-highlighted">{{ title }}</p>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
      <p class="mt-1 text-xs text-muted">Fixture UI override</p>
    </div>
    <div v-if="$slots.actions" class="mt-1 flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
