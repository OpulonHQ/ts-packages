<script setup lang="ts">
/**
 * <FieldTextarea v-model="state.notes" name="notes" :label="..." :rows="3" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
import { computed } from 'vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<string | null>()
const value = computed({
  get: () => model.value ?? undefined,
  set: (next: string | undefined) => (model.value = next ?? null),
})

withDefaults(defineProps<FieldProps & { rows?: number; autoresize?: boolean }>(), {
  rows: 3,
  autoresize: false,
})
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
    <UTextarea
      v-model="value"
      :rows="rows"
      :autoresize="autoresize"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full"
    />
  </UFormField>
</template>
