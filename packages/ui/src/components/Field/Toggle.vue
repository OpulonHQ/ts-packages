<script setup lang="ts">
/**
 * <FieldToggle v-model="state.active" name="active" :label="..." :help="..." />
 *
 * The switch carries the label; a `hint` sits at the end of the label's row and is part of it.
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<boolean>({ default: false })

defineProps<FieldProps>()

const withHint = { root: 'w-full', wrapper: 'flex-1', label: 'flex justify-between gap-1' }
</script>

<template>
  <UFormField
    :name="name"
    :description="description"
    :help="help"
    :required="required"
    :size="size"
  >
    <USwitch v-model="model" :label="label" :disabled="disabled" :ui="hint ? withHint : undefined">
      <template v-if="hint" #label>
        {{ label }} <span class="font-normal text-muted">{{ hint }}</span>
      </template>
    </USwitch>
  </UFormField>
</template>
