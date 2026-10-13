<script setup lang="ts">
/**
 * <FieldToggle v-model="state.active" name="active" :label="..." :help="..." />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<boolean>({ default: false })

defineProps<FieldProps>()
</script>

<template>
  <UFormField
    :name="name"
    :description="description"
    :help="help"
    :hint="hint"
    :required="required"
    :size="size"
  >
    <USwitch v-model="model" :label="label" :disabled="disabled" />
  </UFormField>
</template>
