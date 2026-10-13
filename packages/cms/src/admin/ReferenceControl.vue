<script setup lang="ts">
/** Item(s) of one collection: a select, or a checkbox per item for `many`. */
import { UCheckbox } from '@opulonjs/ui'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import { computed, onMounted, ref } from 'vue'
import type { Field } from '../api.ts'
import { useContent } from './use-cms.ts'

const model = defineModel<unknown>()
const props = defineProps<{ field: Field; name: string; label: string; disabled?: boolean }>()

const content = useContent()
const options = ref<Array<{ value: string; label: string }>>([])
// ponytail: loads every item of the collection; add search when collections grow past ~500.
onMounted(async () => {
  try {
    options.value = (await content.listItems(props.field.collection ?? '')).rows.map((row) => ({
      value: row.id,
      label: row.title,
    }))
  } catch {
    // Without the collections permission the control stays empty and keeps its value.
  }
})

const selected = computed(() =>
  Array.isArray(model.value) ? model.value.filter((v) => typeof v === 'string') : [],
)
const toggle = (id: string, on: boolean) =>
  (model.value = on ? [...selected.value, id] : selected.value.filter((v) => v !== id))
const single = computed({
  get: () => (typeof model.value === 'string' ? model.value : null),
  set: (value: string | number | null) => (model.value = value === null ? null : String(value)),
})
</script>

<template>
  <fieldset v-if="field.many" class="space-y-1">
    <legend class="text-sm font-medium text-highlighted">{{ label }}</legend>
    <UCheckbox
      v-for="option in options"
      :key="option.value"
      :model-value="selected.includes(option.value)"
      :name="`${name}.${option.value}`"
      :label="option.label"
      :disabled="disabled"
      @update:model-value="(on: boolean | 'indeterminate') => toggle(option.value, on === true)"
    />
  </fieldset>
  <FieldSelect
    v-else
    v-model="single"
    :name="name"
    :label="label"
    :items="options"
    :disabled="disabled"
  />
</template>
