<script setup lang="ts">
/**
 * A day as `YYYY-MM-DD`, in the browser's native date input.
 *
 * <FieldDate v-model="state.dueOn" name="dueOn" :label="t('demo.fields.dueOn')" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed } from 'vue'
import { srOnlyHint, type FieldProps } from '../../fields.ts'

const model = defineModel<string | null>()
const value = computed({
  get: () => model.value ?? '',
  set: (next: string) => (model.value = next || null),
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
    <UInput v-model="value" type="date" :min="min" :max="max" :disabled="disabled" class="w-full" />
  </UFormField>
</template>
