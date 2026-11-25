<script setup lang="ts">
/**
 * A moment as an ISO 8601 UTC instant (`2026-11-07T13:37:00.000Z`), edited in the browser's
 * native date and time input in its own time zone, to the minute.
 *
 * <FieldDateTime v-model="state.publishAt" name="publishAt" :label="t('demo.fields.publishAt')" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed } from 'vue'
import { srOnlyHint, type FieldProps } from '../../fields.ts'
import { localIso, toDate } from '../../format.ts'

const model = defineModel<string | null>()
const local = (instant: string | null | undefined) => {
  const date = toDate(instant)
  return date ? localIso(date) : ''
}
const value = computed({
  get: () => local(model.value),
  set: (next: string) => (model.value = toDate(next)?.toISOString() ?? null),
})

defineProps<FieldProps & { min?: string; max?: string }>()
</script>

<template>
  <UFormField
    :name="name"
    :label="label"
    :description="description"
    :help="help"
    :hint="hint ?? srHint"
    :ui="hint === undefined && srHint !== undefined ? srOnlyHint : undefined"
    :required="required"
    :size="size"
  >
    <UInput
      v-model="value"
      type="datetime-local"
      :min="local(min) || undefined"
      :max="local(max) || undefined"
      :disabled="disabled"
      class="w-full"
    />
  </UFormField>
</template>
