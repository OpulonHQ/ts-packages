<script setup lang="ts">
/**
 * <StatusBadge status="published" />                    generic lifecycle color
 * <StatusBadge :status="row.state" :label="t(...)" color="info" />
 * <StatusBadge :status="row.name" :hex="row.color" />   a color stored with the data
 */
import UBadge from '@nuxt/ui/components/Badge.vue'
import { computed } from 'vue'
import { type BadgeColor, EMPTY_PLACEHOLDER, humanize, statusColor } from '../format.ts'

const props = defineProps<{
  status: string | null | undefined
  /** Display label; defaults to the humanized status. */
  label?: string
  color?: BadgeColor
  /** Raw hex color; wins over `color`. */
  hex?: string | null
}>()

const text = computed(() => props.label ?? (props.status ? humanize(props.status) : ''))
const color = computed(() => props.color ?? statusColor(props.status))
// light-dark() keeps data-driven colors readable in dark mode too.
const hexStyle = computed(() =>
  props.hex
    ? {
        backgroundColor: `light-dark(color-mix(in srgb, ${props.hex} 12%, white), color-mix(in srgb, ${props.hex} 20%, black))`,
        borderColor: `light-dark(color-mix(in srgb, ${props.hex} 30%, white), color-mix(in srgb, ${props.hex} 45%, black))`,
        color: `light-dark(color-mix(in srgb, ${props.hex} 75%, black), color-mix(in srgb, ${props.hex} 60%, white))`,
      }
    : undefined,
)
</script>

<template>
  <span
    v-if="status && hex"
    class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :style="hexStyle"
  >
    {{ text }}
  </span>
  <UBadge v-else-if="status" :color="color" variant="subtle" class="whitespace-nowrap">
    {{ text }}
  </UBadge>
  <span v-else class="text-muted">{{ EMPTY_PLACEHOLDER }}</span>
</template>
