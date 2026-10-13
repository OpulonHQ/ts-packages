<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { MediaPicker } from '@opulonjs/media/admin'
import FieldText from '@opulonjs/ui/components/Field/Text'
import FieldTextarea from '@opulonjs/ui/components/Field/Textarea'
import FieldToggle from '@opulonjs/ui/components/Field/Toggle'
import LocaleTabs from '@opulonjs/ui/components/LocaleTabs'
import type { PageLocale } from '../api.ts'

defineProps<{
  value: Record<string, PageLocale>
  locales: ReadonlyArray<string>
  disabled?: boolean
  namePrefix?: string
}>()

const { t } = useI18n()
</script>

<template>
  <LocaleTabs :locales="locales">
    <template v-for="code in locales" :key="code" #[code]>
      <FieldText
        v-model="value[code]!.path"
        :name="`${namePrefix ?? 'locales'}.${code}.path`"
        :label="t('cms.page.path')"
        :help="t('cms.page.pathHelp')"
        :disabled="disabled"
      />
      <FieldToggle
        v-model="value[code]!.available"
        :name="`${namePrefix ?? 'locales'}.${code}.available`"
        :label="t('cms.page.available')"
        :disabled="disabled"
      />
      <FieldText
        v-model="value[code]!.seo.title"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.title`"
        :label="t('cms.page.seoTitle')"
        :disabled="disabled"
      />
      <FieldTextarea
        v-model="value[code]!.seo.description"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.description`"
        :label="t('cms.page.seoDescription')"
        :rows="2"
        :disabled="disabled"
      />
      <MediaPicker
        v-model="value[code]!.seo.image"
        :label="t('cms.page.seoImage')"
        accept="image"
        :disabled="disabled"
      />
      <FieldToggle
        v-model="value[code]!.seo.noindex"
        :name="`${namePrefix ?? 'locales'}.${code}.seo.noindex`"
        :label="t('cms.page.noindex')"
        :disabled="disabled"
      />
    </template>
  </LocaleTabs>
</template>
