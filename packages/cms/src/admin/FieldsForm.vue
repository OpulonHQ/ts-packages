<script setup lang="ts">
/**
 * The generated form of a field group (a section type, a collection, the site settings): one
 * control per field, localized fields in a tab per content locale. Edits `data` in place.
 */
import { useI18n } from '@opulonjs/admin'
import LocaleTabs from '@opulonjs/ui/components/LocaleTabs'
import { type FieldGroup, labelText } from '../api.ts'
import FieldControl from './FieldControl.vue'

const data = defineModel<Record<string, unknown>>('data', { required: true })
defineProps<{
  group: FieldGroup
  locales: ReadonlyArray<string>
  /** Form path prefix, e.g. `sections.0`; controls are named `<prefix>.<field>[.<locale>]`. */
  name: string
  disabled?: boolean
}>()

const { locale } = useI18n()

/** A localized field's `{ [locale]: value }`, created on first use. */
const localized = (data: Record<string, unknown>, field: string) => {
  const current = data[field]
  if (current !== null && typeof current === 'object') return current as Record<string, unknown>
  return (data[field] = {}) as Record<string, unknown>
}
</script>

<template>
  <div class="space-y-4">
    <template v-for="(field, key) in group.fields" :key="key">
      <fieldset v-if="field.localized" class="space-y-2">
        <legend class="text-sm font-medium text-highlighted">
          {{ labelText(field.label, locale) }}
        </legend>
        <LocaleTabs :locales="locales">
          <template v-for="code in locales" :key="code" #[code]>
            <FieldControl
              v-model="localized(data, String(key))[code]"
              :field="field"
              :name="`${name}.${key}.${code}`"
              :label="labelText(field.label, locale)"
              :disabled="disabled"
            />
          </template>
        </LocaleTabs>
      </fieldset>
      <FieldControl
        v-else
        v-model="data[key]"
        :field="field"
        :name="`${name}.${key}`"
        :label="labelText(field.label, locale)"
        :disabled="disabled"
      />
    </template>
  </div>
</template>
