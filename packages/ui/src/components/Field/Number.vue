<script setup lang="ts">
/**
 * <FieldNumber v-model="state.sortOrder" name="sortOrder" :label="..." :min="0" :step="1" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInputNumber from '@nuxt/ui/components/InputNumber.vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<number | null>()

defineProps<FieldProps & { min?: number; max?: number; step?: number }>()
</script>

<template>
  <UFormField
    :name="name"
    :label="label"
    :description="description"
    :help="help"
    :hint="hint"
    :required="required"
    :size="size"
  >
    <UInputNumber
      v-model="model"
      :min="min"
      :max="max"
      :step="step"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full"
    />
  </UFormField>
</template>
