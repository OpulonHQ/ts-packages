<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { MediaPicker } from '@opulonjs/media/admin'
import FieldText from '@opulonjs/ui/components/Field/Text'
import FieldTextarea from '@opulonjs/ui/components/Field/Textarea'
import FieldToggle from '@opulonjs/ui/components/Field/Toggle'
import { computed } from 'vue'
import type { PageLocale } from '../api.ts'
import { shownLocale, useLocaleHints } from './use-cms.ts'

const props = defineProps<{
  value: Record<string, PageLocale>
  locales: ReadonlyArray<string>
  locale?: string
  disabled?: boolean
  namePrefix?: string
}>()

const { t } = useI18n()
const shown = computed(() => shownLocale(props.locales, props.locale))
const hints = useLocaleHints(() => props.locales)
</script>

<template>
  <div>
    <div v-for="code in locales" v-show="code === shown" :key="code" class="space-y-4">
      <FieldText
        v-model="value[code]!.path"
        :name="`${namePrefix ?? 'locales'}.${code}.path`"
        :label="t('cms.page.path')"
        :sr-hint="hints.language(code)"
        :help="t('cms.page.pathHelp')"
        :disabled="disabled"
      />
      <FieldToggle
        v-model="value[code]!.available"
        :name="`${namePrefix ?? 'locales'}.${code}.available`"
        :label="t('cms.page.available')"
        :sr-hint="hints.language(code)"
        :disabled="disabled"
      />
      <FieldText
        v-model="value[code]!.seo.title"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.title`"
        :label="t('cms.page.seoTitle')"
        :sr-hint="hints.language(code)"
        :disabled="disabled"
      />
      <FieldTextarea
        v-model="value[code]!.seo.description"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.description`"
        :label="t('cms.page.seoDescription')"
        :sr-hint="hints.language(code)"
        :rows="2"
        :disabled="disabled"
      />
      <MediaPicker
        v-model="value[code]!.seo.image"
        :label="t('cms.page.seoImage')"
        :sr-hint="hints.language(code)"
        accept="image"
        :disabled="disabled"
      />
      <FieldToggle
        v-model="value[code]!.seo.noindex"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.noindex`"
        :label="t('cms.page.noindex')"
        :sr-hint="hints.language(code)"
        :disabled="disabled"
      />
    </div>
  </div>
</template>
