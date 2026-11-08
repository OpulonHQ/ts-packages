<script setup lang="ts">
/** A host widget for `fields.custom({ widget: 'color' })`: a native colour input. */
const model = defineModel<unknown>()
defineProps<{ name: string; label: string; hint?: string; disabled?: boolean }>()
</script>

<template>
  <label class="flex items-center gap-2 text-sm">
    <input
      type="color"
      :name="name"
      :value="typeof model === 'string' ? model : '#000000'"
      :disabled="disabled"
      @input="model = ($event.target as HTMLInputElement).value"
    />
    {{ label }}
    <span v-if="hint" class="ms-auto text-muted">{{ hint }}</span>
  </label>
</template>
