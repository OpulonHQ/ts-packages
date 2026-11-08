<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import LocaleSwitch from '@opulonjs/ui/components/LocaleSwitch'
import { computed, ref, shallowRef, watch } from 'vue'
import { labelText, type PageLocale } from '../api.ts'
import { emptyLocale } from '../localize.ts'
import FieldsForm from './FieldsForm.vue'
import LocaleDetails from './LocaleDetails.vue'
import MenuItemsEditor, { type EditedMenuItem } from './MenuItemsEditor.vue'
import { shownLocale, useCmsContext, useContent } from './use-cms.ts'
import type { RevisionSnapshot } from './use-revisions.ts'

const props = defineProps<{
  snapshot: RevisionSnapshot
  documentRef: string
  collection?: string
}>()
const contentLocale = defineModel<string>('contentLocale')
const { t, locale } = useI18n()
const { definitions } = useCmsContext()
const content = useContent()

const locales = computed(() => {
  const document = props.snapshot.revision.document
  const own = 'locales' in document ? Object.keys(document.locales) : []
  return [...new Set([...content.contentLocales.value, ...own])]
})
const snapshotOnly = ref<string>()
watch(contentLocale, () => (snapshotOnly.value = undefined))
const shown = computed({
  get: () =>
    snapshotOnly.value !== undefined && locales.value.includes(snapshotOnly.value)
      ? snapshotOnly.value
      : shownLocale(locales.value, contentLocale.value),
  set: (code: string) => {
    if (content.contentLocales.value.includes(code)) {
      snapshotOnly.value = undefined
      contentLocale.value = code
    } else snapshotOnly.value = code
  },
})
const withLocales = (own: Readonly<Record<string, PageLocale>>) =>
  Object.fromEntries(locales.value.map((code) => [code, own[code] ?? emptyLocale()]))
const editable = (snapshot: RevisionSnapshot): RevisionSnapshot => {
  const clone = structuredClone(snapshot)
  if (clone.kind === 'page') {
    const { revision } = clone
    const document = { ...revision.document, locales: withLocales(revision.document.locales) }
    return { kind: 'page', revision: { ...revision, document } }
  }
  if (clone.kind === 'item') {
    const { revision } = clone
    const document = { ...revision.document, locales: withLocales(revision.document.locales) }
    return { kind: 'item', revision: { ...revision, document } }
  }
  return clone
}
const form = shallowRef(editable(props.snapshot))
watch(
  () => props.snapshot,
  (snapshot) => {
    form.value = editable(snapshot)
  },
)
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
    <LocaleSwitch v-model="shown" :locales="locales" />
    <template v-if="snapshot.kind === 'page' && form.kind === 'page'">
      <LocaleDetails
        :value="form.revision.document.locales"
        :locales="locales"
        :locale="shown"
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
          :locale="shown"
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
        :locale="shown"
        disabled
        name-prefix="revision.locales"
      />
      <FieldsForm
        v-if="collection && definitions.collections[collection]"
        :data="form.revision.document.data"
        :group="definitions.collections[collection]!"
        :locales="locales"
        :locale="shown"
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
      :locale="shown"
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
        :locale="shown"
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
