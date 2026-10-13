<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { listDefaultPerPage, listMaxOffset } from '@opulonjs/core/api'
import { type TableQuery, UButton, UCheckbox } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Field, ItemSummary } from '../api.ts'
import { useContent } from './use-cms.ts'

const model = defineModel<unknown>()
const props = defineProps<{ field: Field; name: string; label: string; disabled?: boolean }>()
const { t } = useI18n()
const content = useContent()
const chosen = shallowRef<ReadonlyArray<{ id: string; title: string }>>([])
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
    const rows: Array<{ id: string; title: string }> = []
    for (const id of ids) {
      try {
        const item = await content.getItem(id)
        if (ticket !== latest) return
        if (item.collection === collection) rows.push(item)
        else rows.push({ id, title: id })
      } catch {
        if (ticket !== latest) return
        rows.push({ id, title: id })
        failed.value = true
      }
    }
    if (ticket === latest) chosen.value = rows
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
function toggle(id: string) {
  if (props.disabled) return
  model.value = props.field.many
    ? selected.value.includes(id)
      ? selected.value.filter((value) => value !== id)
      : [...selected.value, id]
    : id
}
const pick = (row: ItemSummary) => toggle(row.id)
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
        :label="chosen.find((item) => item.id === id)?.title ?? id"
        :aria-label="
          t('cms.reference.remove', { title: chosen.find((item) => item.id === id)?.title ?? id })
        "
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
      :on-row-click="disabled ? undefined : pick"
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
          @update:model-value="toggle(row.original.id)"
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
