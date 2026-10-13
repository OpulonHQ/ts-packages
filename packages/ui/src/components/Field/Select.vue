<script setup lang="ts">
/**
 * <FieldSelect v-model="state.status" name="status" :label="..."
 *   :items="[{ label: t('...'), value: 'draft' }, { label: t('...'), value: 'published' }]" />
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue'
import { computed } from 'vue'
import type { FieldProps, SelectItem } from '../../fields.ts'
import { useKitText } from '../../text.ts'

const model = defineModel<string | number | null>()
const value = computed({
  get: () => model.value ?? undefined,
  set: (next: string | number | undefined) => (model.value = next ?? null),
})

const props = defineProps<FieldProps & { items: ReadonlyArray<SelectItem | string> }>()
const options = computed<SelectItem[]>(() =>
  props.items.map((item) => (typeof item === 'string' ? { label: item, value: item } : item)),
)
const text = useKitText()
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
    <USelectMenu
      v-model="value"
      :items="options"
      value-key="value"
      label-key="label"
      :placeholder="placeholder ?? text.select"
      :disabled="disabled"
      :search-input="options.length > 8"
      class="w-full"
    />
  </UFormField>
</template>
