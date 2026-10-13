<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { listDefaultPerPage, listMaxOffset, listMaxPerPage } from '@opulonjs/core/api'
import { type TableQuery, UButton, UCheckbox } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Field, ItemSummary } from '../api.ts'
import { useContent } from './use-cms.ts'

const model = defineModel<unknown>()
const props = defineProps<{ field: Field; name: string; label: string; disabled?: boolean }>()
const { t } = useI18n()
const content = useContent()
type SelectedReference =
  | { readonly kind: 'item'; readonly title: string; readonly collection: string }
  | { readonly kind: 'missing'; readonly collection: string }
const chosen = shallowRef<ReadonlyMap<string, SelectedReference>>(new Map())
const failed = ref(false)
const selected = computed<ReadonlyArray<string>>(() =>
  props.field.many
    ? Array.isArray(model.value)
      ? model.value.filter((v): v is string => typeof v === 'string')
      : []
    : typeof model.value === 'string' && model.value !== ''
      ? [model.value]
      : [],
)
let latest = 0
onBeforeUnmount(() => latest++)
watch(
  [selected, () => props.field.collection],
  async ([ids, collection]) => {
    const ticket = ++latest
    failed.value = false
    const wanted = new Set(ids)
    const rows = new Map(
      [...chosen.value].filter(([id, item]) => wanted.has(id) && item.collection === collection),
    )
    chosen.value = rows
    const missing = [...wanted].filter((id) => !rows.has(id))
    if (missing.length === 0) return
    for (let start = 0; start < missing.length; start += listMaxPerPage) {
      const batch = missing.slice(start, start + listMaxPerPage)
      try {
        const result = await content.listItems(collection ?? '', {
          ids: batch.join(','),
          perPage: listMaxPerPage,
          sort: 'title',
          direction: 'asc',
        })
        if (ticket !== latest) return
        const byId = new Map(result.rows.map((item) => [item.id, item]))
        for (const id of batch) {
          const item = byId.get(id.toLowerCase())
          rows.set(
            id,
            item
              ? { kind: 'item', title: item.title, collection: item.collection }
              : { kind: 'missing', collection: collection ?? '' },
          )
        }
        chosen.value = new Map(rows)
      } catch {
        if (ticket === latest) failed.value = true
        return
      }
    }
  },
  { immediate: true },
)

const columns = computed(() => [
  ...(props.field.many ? [{ key: 'selected', label: t('cms.reference.selected') }] : []),
  { key: 'title', label: t('cms.columns.title'), sortable: true },
])
const load = (query: TableQuery) =>
  content.listItems(props.field.collection ?? '', {
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    sort: 'title',
    direction: query.sort?.direction ?? 'asc',
  })
function toggle(row: ItemSummary) {
  if (props.disabled) return
  const id = row.id
  chosen.value = new Map(chosen.value).set(id, {
    kind: 'item',
    title: row.title,
    collection: row.collection,
  })
  model.value = props.field.many
    ? selected.value.includes(id)
      ? selected.value.filter((value) => value !== id)
      : [...selected.value, id]
    : id
}
const selectedTitle = (id: string) => {
  const item = chosen.value.get(id)
  return item?.kind === 'missing' ? t('cms.reference.missing', { id }) : (item?.title ?? id)
}
</script>

<template>
  <fieldset class="space-y-2">
    <legend class="text-sm font-medium text-highlighted">{{ label }}</legend>
    <div
      v-if="selected.length"
      class="flex flex-wrap gap-2"
      :aria-label="t('cms.reference.selected')"
    >
      <UButton
        v-for="id in selected"
        :key="id"
        size="sm"
        color="neutral"
        variant="outline"
        :label="selectedTitle(id)"
        :aria-label="t('cms.reference.remove', { title: selectedTitle(id) })"
        :disabled="disabled"
        icon="i-lucide-x"
        @click="model = field.many ? selected.filter((value) => value !== id) : null"
      />
    </div>
    <p v-if="failed" role="alert" class="text-sm text-error">{{ t('cms.errors.failed') }}</p>
    <DataTable
      :key="field.collection"
      :columns="columns"
      :load="load"
      :caption="label"
      :per-page="listDefaultPerPage"
      :max-page="Math.floor(listMaxOffset / listDefaultPerPage) + 1"
      :empty-title="t('cms.reference.empty')"
      :search-placeholder="t('cms.reference.search')"
      searchable
      :on-row-click="disabled ? undefined : toggle"
    >
      <template #error
        ><p role="alert" class="text-sm text-error">{{ t('cms.errors.failed') }}</p></template
      >
      <template #pagination-limit>{{ t('cms.collections.paginationLimit') }}</template>
      <template #selected-cell="{ row }">
        <UCheckbox
          :name="`${name}.${row.original.id}`"
          :aria-label="row.original.title"
          :model-value="selected.includes(row.original.id)"
          :disabled="disabled"
          @click.stop
          @update:model-value="toggle(row.original)"
        />
      </template>
      <template #title-cell="{ row }">
        <span :class="selected.includes(row.original.id) && 'font-semibold text-primary'">{{
          row.original.title
        }}</span>
      </template>
    </DataTable>
  </fieldset>
</template>
