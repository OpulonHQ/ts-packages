<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { computed, shallowRef, watch } from 'vue'
import { labelText } from '../api.ts'
import FieldsForm from './FieldsForm.vue'
import LocaleDetails from './LocaleDetails.vue'
import MenuItemsEditor, { type EditedMenuItem } from './MenuItemsEditor.vue'
import { useCmsContext, useContent } from './use-cms.ts'
import type { RevisionSnapshot } from './use-revisions.ts'

const props = defineProps<{
  snapshot: RevisionSnapshot
  documentRef: string
  collection?: string
}>()
const { t, locale } = useI18n()
const { definitions } = useCmsContext()
const content = useContent()
const form = shallowRef(structuredClone(props.snapshot))
watch(
  () => props.snapshot,
  (snapshot) => {
    form.value = structuredClone(snapshot)
  },
)
const locales = computed(() => {
  const document = props.snapshot.revision.document
  return 'locales' in document ? Object.keys(document.locales) : content.contentLocales.value
})
const menuItems = computed<EditedMenuItem[]>(() =>
  form.value.kind === 'menu'
    ? form.value.revision.document.items.map(function copy(item): EditedMenuItem {
        return { ...item, label: { ...item.label }, children: item.children.map(copy) }
      })
    : [],
)
</script>

<template>
  <div class="space-y-4">
    <template v-if="snapshot.kind === 'page' && form.kind === 'page'">
      <LocaleDetails
        :value="form.revision.document.locales"
        :locales="locales"
        disabled
        name-prefix="revision.locales"
      />
      <p v-if="form.revision.document.sections.length === 0" class="text-sm text-muted">
        {{ t('cms.page.noSections') }}
      </p>
      <div
        v-for="(section, index) in form.revision.document.sections"
        :key="section.id"
        class="space-y-3"
      >
        <h3 class="font-medium">
          {{ labelText(definitions.sections[section.type]?.label, locale) || section.type }}
        </h3>
        <FieldsForm
          v-if="definitions.sections[section.type]"
          :data="section.data"
          :group="definitions.sections[section.type]!"
          :locales="locales"
          :name="`revision.sections.${index}`"
          disabled
        />
        <pre v-else class="overflow-auto whitespace-pre-wrap text-sm">{{
          JSON.stringify(snapshot.revision.document.sections[index]?.data, null, 2)
        }}</pre>
      </div>
    </template>
    <template v-else-if="snapshot.kind === 'item' && form.kind === 'item'">
      <LocaleDetails
        :value="form.revision.document.locales"
        :locales="locales"
        disabled
        name-prefix="revision.locales"
      />
      <FieldsForm
        v-if="collection && definitions.collections[collection]"
        :data="form.revision.document.data"
        :group="definitions.collections[collection]!"
        :locales="locales"
        name="revision.data"
        disabled
      />
      <pre v-else class="overflow-auto whitespace-pre-wrap text-sm">{{
        JSON.stringify(snapshot.revision.document.data, null, 2)
      }}</pre>
    </template>
    <FieldsForm
      v-else-if="form.kind === 'settings'"
      :data="form.revision.document.data"
      :group="definitions.settings"
      :locales="locales"
      name="revision.data"
      disabled
    />
    <template v-else>
      <p v-if="menuItems.length === 0" class="text-sm text-muted">{{ t('cms.menus.empty') }}</p>
      <MenuItemsEditor
        :items="menuItems"
        :level="1"
        :depth="definitions.menus[documentRef]?.depth ?? 3"
        :locales="locales"
        name="revision.items"
        disabled
      />
    </template>
    <details>
      <summary class="cursor-pointer text-sm text-muted">{{ t('cms.revisions.snapshot') }}</summary>
      <pre class="mt-2 overflow-auto whitespace-pre-wrap break-words text-sm">{{
        JSON.stringify(snapshot.revision.document, null, 2)
      }}</pre>
    </details>
  </div>
</template>
