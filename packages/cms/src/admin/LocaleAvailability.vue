<script setup lang="ts">
/** The content locales a page or item is available in: a checkbox per language, or one
 *  "Available" checkbox while the host has a single content locale. */
import { useI18n } from '@opulonjs/admin'
import { languageName, UCheckbox } from '@opulonjs/ui'
import type { PageLocale } from '../api.ts'

defineProps<{
  value: Record<string, PageLocale>
  locales: ReadonlyArray<string>
  disabled?: boolean
}>()

const { t, locale } = useI18n()
</script>

<template>
  <fieldset class="space-y-2">
    <legend
      class="mb-2 text-sm font-medium text-highlighted"
      :class="{ 'sr-only': locales.length < 2 }"
    >
      {{ t('cms.page.languages') }}
    </legend>
    <UCheckbox
      v-for="code in locales"
      :key="code"
      v-model="value[code]!.available"
      :name="`locales.${code}.available`"
      :label="locales.length > 1 ? languageName(code, locale) : t('cms.page.available')"
      :disabled="disabled"
    />
    <p v-if="locales.length > 1" class="text-sm text-muted">{{ t('cms.page.languagesHelp') }}</p>
  </fieldset>
</template>
