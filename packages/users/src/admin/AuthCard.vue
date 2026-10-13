<script setup lang="ts">
/** The frame of the public auth screens: brand, title, an optional alert, the form. */
import { useAdmin } from '@opulonjs/admin'
import { UAlert, UCard } from '@opulonjs/ui'

defineProps<{
  title: string
  description?: string | undefined
  error?: string | undefined
  notice?: string | undefined
}>()
const { brand } = useAdmin()
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-2">
          <img v-if="brand.logo" :src="brand.logo" alt="" class="size-6 shrink-0" />
          <p class="text-sm text-muted">{{ brand.name }}</p>
        </div>
        <h1 class="mt-2 text-lg font-semibold text-highlighted">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
      </template>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
        <UAlert
          v-if="notice"
          role="status"
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          :title="notice"
        />
        <slot />
      </div>
    </UCard>
  </div>
</template>
