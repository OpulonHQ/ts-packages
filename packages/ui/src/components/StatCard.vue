<script setup lang="ts">
/**
 * <StatCard :label="t('demo.stats.notes')" :value="count" icon="i-lucide-notebook"
 *   :to="{ name: 'demo.notes' }" :loading="pending" />
 */
import UCard from '@nuxt/ui/components/Card.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import ULink from '@nuxt/ui/components/Link.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { EMPTY_PLACEHOLDER } from '../format.ts'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number | null | undefined
    icon?: string
    /** Small line under the value, e.g. "+12% vs last month". */
    delta?: string
    deltaColor?: 'success' | 'error' | 'neutral'
    /** Makes the whole card a link. */
    to?: RouteLocationRaw
    loading?: boolean
  }>(),
  { deltaColor: 'neutral', loading: false },
)

const display = computed(() =>
  props.value === null || props.value === undefined || props.value === ''
    ? EMPTY_PLACEHOLDER
    : typeof props.value === 'number'
      ? props.value.toLocaleString()
      : props.value,
)
const deltaClass = computed(
  () => ({ success: 'text-success', error: 'text-error', neutral: 'text-muted' })[props.deltaColor],
)
</script>

<template>
  <UCard
    :class="
      to ? 'relative transition hover:ring-primary/40 focus-within:ring-primary/40' : undefined
    "
    :ui="{ body: 'p-4 sm:p-5' }"
  >
    <component
      :is="to ? ULink : 'div'"
      :to="to"
      class="flex items-start justify-between gap-3"
      :class="to ? 'focus:outline-none after:absolute after:inset-0' : undefined"
    >
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-muted">{{ label }}</p>
        <USkeleton v-if="loading" class="mt-1.5 h-7 w-20" />
        <p v-else class="mt-1 text-2xl font-semibold tabular-nums text-highlighted">
          {{ display }}
        </p>
        <p v-if="delta && !loading" class="mt-1 text-xs font-medium" :class="deltaClass">
          {{ delta }}
        </p>
      </div>
      <div
        v-if="icon"
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"
      >
        <UIcon :name="icon" class="size-5 text-primary" aria-hidden="true" />
      </div>
    </component>
  </UCard>
</template>
