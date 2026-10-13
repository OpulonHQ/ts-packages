<script setup lang="ts">
/** A link: a page, an item of a routed collection, a system page or a URL. Stores the target,
 *  not its path. */
import { useI18n } from '@opulonjs/admin'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { fields, labelText, type ItemSummary, type Link } from '../api.ts'
import { pageTitle, useCmsContext, useContent } from './use-cms.ts'
import ReferenceControl from './ReferenceControl.vue'

const model = defineModel<unknown>()
const props = defineProps<{ name: string; label: string; disabled?: boolean }>()

const { t, locale } = useI18n()
const { definitions } = useCmsContext()
const content = useContent()
const pages = ref<Array<{ value: string; label: string }>>([])
const failure = ref(false)
const itemCollection = ref<string | null>(null)
const knownItem = shallowRef<Pick<ItemSummary, 'id' | 'collection'>>()
const routed = computed(() =>
  Object.entries(definitions.collections)
    .filter(([, collection]) => collection.routed)
    .map(([key, collection]) => ({ value: key, label: labelText(collection.label, locale.value) })),
)
let latest = 0
onBeforeUnmount(() => latest++)

const isLink = (value: unknown): value is Link =>
  typeof value === 'object' && value !== null && 'type' in value
const link = computed(() => (isLink(model.value) ? model.value : null))

const types = computed(() => [
  { value: 'page', label: t('cms.link.page') },
  { value: 'item', label: t('cms.link.item') },
  { value: 'system', label: t('cms.link.system') },
  { value: 'url', label: t('cms.link.url') },
])
const type = computed({
  get: () => link.value?.type ?? null,
  set: (next: string | number | null) => {
    model.value =
      next === 'url'
        ? { type: 'url', url: '' }
        : next === 'system'
          ? { type: 'system', key: Object.keys(definitions.systemPages)[0] ?? '' }
          : next === 'page' || next === 'item'
            ? { type: next, id: '' }
            : null
  },
})
const systemPages = computed(() =>
  Object.entries(definitions.systemPages).map(([key, page]) => ({
    value: key,
    label: labelText(page.label, locale.value),
  })),
)
const target = computed({
  get: () => {
    const l = link.value
    return l === null ? null : l.type === 'system' ? l.key : l.type === 'url' ? null : l.id || null
  },
  set: (value: string | number | null) => {
    const l = link.value
    if (!l) return
    if (value === null) {
      if (l.type === 'item' || l.type === 'page') model.value = null
      return
    }
    if (l.type === 'system') model.value = { type: 'system', key: String(value) }
    else if (l.type === 'page' || l.type === 'item') {
      if (l.type === 'item' && itemCollection.value)
        knownItem.value = { id: String(value), collection: itemCollection.value }
      model.value = { type: l.type, id: String(value) }
    }
  },
})
const url = computed({
  get: () => (link.value?.type === 'url' ? link.value.url : ''),
  set: (value: string | null) => (model.value = { type: 'url', url: value ?? '' }),
})

watch(
  [
    () => link.value?.type,
    () =>
      link.value?.type === 'item' && link.value.id !== knownItem.value?.id
        ? link.value.id
        : undefined,
  ],
  async ([kind, unresolvedId]) => {
    const ticket = ++latest
    failure.value = false
    if (kind === 'page') {
      try {
        const result = await content.listPages()
        if (ticket === latest)
          pages.value = result.rows.map((row) => ({
            value: row.id,
            label: pageTitle(definitions, row, locale.value),
          }))
      } catch {
        if (ticket === latest) failure.value = true
      }
    } else if (kind === 'item') {
      if (!unresolvedId) {
        if (!itemCollection.value) itemCollection.value = routed.value[0]?.value ?? null
        return
      }
      try {
        const item = await content.getItem(unresolvedId)
        if (ticket === latest) {
          knownItem.value = { id: item.id, collection: item.collection }
          itemCollection.value = item.collection
        }
      } catch {
        if (ticket === latest) failure.value = true
      }
    }
  },
  { immediate: true },
)
function selectCollection(value: string | number | null | undefined) {
  latest++
  itemCollection.value = value === null || value === undefined ? null : String(value)
  knownItem.value = undefined
  model.value = { type: 'item', id: '' }
}
</script>

<template>
  <fieldset class="space-y-2">
    <legend class="text-sm font-medium text-highlighted">{{ props.label }}</legend>
    <FieldSelect
      v-model="type"
      :name="`${name}.type`"
      :label="t('cms.link.type')"
      :items="types"
      :placeholder="t('cms.link.none')"
      :disabled="disabled"
    />
    <FieldSelect
      v-if="link && (link.type === 'page' || link.type === 'system')"
      v-model="target"
      :name="`${name}.target`"
      :label="t('cms.link.target')"
      :items="link.type === 'page' ? pages : systemPages"
      :disabled="disabled"
    />
    <template v-if="link?.type === 'item'">
      <FieldSelect
        :model-value="itemCollection"
        :name="`${name}.collection`"
        :label="t('cms.link.collection')"
        :items="routed"
        :disabled="disabled"
        @update:model-value="selectCollection"
      />
      <ReferenceControl
        v-if="itemCollection"
        v-model="target"
        :field="fields.reference({ label: props.label, collection: itemCollection })"
        :name="`${name}.target`"
        :label="t('cms.link.target')"
        :disabled="disabled"
      />
    </template>
    <p v-if="failure" role="alert" class="text-sm text-error">{{ t('cms.errors.failed') }}</p>
    <FieldText
      v-if="link?.type === 'url'"
      v-model="url"
      :name="`${name}.url`"
      :label="t('cms.link.url')"
      :help="t('cms.link.urlHelp')"
      :disabled="disabled"
    />
  </fieldset>
</template>
