<script setup lang="ts">
/** One value of a cms field, edited with the field's widget (built-in or registered). */
import { useI18n } from '@opulonjs/admin'
import { MediaPicker } from '@opulonjs/media/admin'
import FieldNumber from '@opulonjs/ui/components/Field/Number'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import FieldText from '@opulonjs/ui/components/Field/Text'
import FieldTextarea from '@opulonjs/ui/components/Field/Textarea'
import FieldToggle from '@opulonjs/ui/components/Field/Toggle'
import { computed, defineAsyncComponent } from 'vue'
import { type Field, labelText } from '../api.ts'
import LinkControl from './LinkControl.vue'
import ReferenceControl from './ReferenceControl.vue'
import { useCmsContext } from './use-cms.ts'

const FieldRichText = defineAsyncComponent(() => import('@opulonjs/ui/components/Field/RichText'))

const model = defineModel<unknown>()
const props = defineProps<{ field: Field; name: string; label: string; disabled?: boolean }>()

const { locale } = useI18n()
const { widgets } = useCmsContext()
const help = computed(() => labelText(props.field.help, locale.value) || undefined)
const items = computed(() =>
  (props.field.options ?? []).map((o) => ({
    value: o.value,
    label: labelText(o.label, locale.value),
  })),
)
const text = computed({
  get: () => (typeof model.value === 'string' ? model.value : null),
  set: (value: string | null) => (model.value = value),
})
const number = computed({
  get: () => (typeof model.value === 'number' ? model.value : null),
  set: (value: number | null) => (model.value = value),
})
const flag = computed({
  get: () => model.value === true,
  set: (value: boolean) => (model.value = value),
})
const select = computed({
  get: () => (typeof model.value === 'string' ? model.value : null),
  set: (value: string | number | null) => (model.value = value),
})
</script>

<template>
  <FieldText
    v-if="field.widget === 'text'"
    v-model="text"
    :name="name"
    :label="label"
    :help="help"
    :disabled="disabled"
  />
  <FieldTextarea
    v-else-if="field.widget === 'textarea'"
    v-model="text"
    :name="name"
    :label="label"
    :help="help"
    :disabled="disabled"
  />
  <FieldRichText
    v-else-if="field.widget === 'richText'"
    v-model="text"
    :name="name"
    :label="label"
    :help="help"
    :disabled="disabled"
  />
  <FieldNumber
    v-else-if="field.widget === 'number'"
    v-model="number"
    :name="name"
    :label="label"
    :help="help"
    :min="field.min"
    :max="field.max"
    :disabled="disabled"
  />
  <FieldSelect
    v-else-if="field.widget === 'select'"
    v-model="select"
    :name="name"
    :label="label"
    :help="help"
    :items="items"
    :disabled="disabled"
  />
  <FieldToggle
    v-else-if="field.widget === 'boolean'"
    v-model="flag"
    :name="name"
    :label="label"
    :help="help"
    :disabled="disabled"
  />
  <MediaPicker
    v-else-if="field.widget === 'media'"
    v-model="text"
    :label="label"
    :accept="field.accept"
    :disabled="disabled"
  />
  <LinkControl
    v-else-if="field.widget === 'link'"
    v-model="model"
    :name="name"
    :label="label"
    :disabled="disabled"
  />
  <ReferenceControl
    v-else-if="field.widget === 'reference'"
    v-model="model"
    :field="field"
    :name="name"
    :label="label"
    :disabled="disabled"
  />
  <component
    :is="widgets[field.widget]"
    v-else
    v-model="model"
    :field="field"
    :name="name"
    :label="label"
    :disabled="disabled"
  />
</template>
