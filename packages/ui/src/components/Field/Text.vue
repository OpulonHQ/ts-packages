<script setup lang="ts">
/**
 * <FieldText v-model="state.name" name="name" :label="t('demo.fields.name')" required />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed } from 'vue'
import type { FieldProps } from '../../fields.ts'

const model = defineModel<string | null>()
// UInput rejects null; keep the external `string | null` contract.
const value = computed({
  get: () => model.value ?? undefined,
  set: (next: string | undefined) => (model.value = next ?? null),
})

withDefaults(
  defineProps<
    FieldProps & {
      type?: 'text' | 'email' | 'password' | 'tel' | 'url'
      icon?: string
      maxlength?: number
    }
  >(),
  { type: 'text' },
)
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
    <UInput
      v-model="value"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :icon="icon"
      :maxlength="maxlength"
      class="w-full"
    />
  </UFormField>
</template>
