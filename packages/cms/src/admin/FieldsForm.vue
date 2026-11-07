<script setup lang="ts">
/**
 * The generated form of a field group (a section type, a collection, the site settings): one
 * control per field. A localized field shows the control of `locale`, the editor's content
 * language; the other locales' controls stay mounted and hidden, so nothing typed in them is lost
 * and focus can find them. With several content locales each control names its language next to
 * its label, or "All languages" for a field every locale shares. Edits `data` in place.
 */
import { useI18n } from '@opulonjs/admin'
import { computed } from 'vue'
import { type FieldGroup, labelText } from '../api.ts'
import FieldControl from './FieldControl.vue'
import { shownLocale, useLocaleHints } from './use-cms.ts'

const data = defineModel<Record<string, unknown>>('data', { required: true })
const props = defineProps<{
  group: FieldGroup
  locales: ReadonlyArray<string>
  /** The content locale whose controls show; default: the first. */
  locale?: string
  /** Form path prefix, e.g. `sections.0`; controls are named `<prefix>.<field>[.<locale>]`. */
  name: string
  disabled?: boolean
}>()

const { locale: adminLocale } = useI18n()
const shown = computed(() => shownLocale(props.locales, props.locale))
const hints = useLocaleHints(() => props.locales)

/** A localized field's `{ [locale]: value }`, created on first use. */
const localized = (data: Record<string, unknown>, field: string) => {
  const current = data[field]
  if (current !== null && typeof current === 'object') return current as Record<string, unknown>
  return (data[field] = {}) as Record<string, unknown>
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="(field, key) in group.fields" :key="key" :data-field="key">
      <template v-if="field.localized">
        <div v-for="code in locales" v-show="code === shown" :key="code">
          <FieldControl
            v-model="localized(data, String(key))[code]"
            :field="field"
            :name="`${name}.${key}.${code}`"
            :label="labelText(field.label, adminLocale)"
            :hint="hints.language(code)"
            :disabled="disabled"
          />
        </div>
      </template>
      <FieldControl
        v-else
        v-model="data[key]"
        :field="field"
        :name="`${name}.${key}`"
        :label="labelText(field.label, adminLocale)"
        :hint="hints.shared()"
        :disabled="disabled"
      />
    </div>
  </div>
</template>
