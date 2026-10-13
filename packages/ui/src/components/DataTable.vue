<script setup lang="ts" generic="Row extends Record<string, unknown>">
/**
 * List table for admin screens: search, select filters, sortable columns, pagination, row
 * selection and an empty state.
 *
 * Client mode: pass `rows`; everything runs in memory.
 * Server mode: pass `load`, which receives a `TableQuery` and returns `{ rows, total }`
 * (usually a call through the module's `useApiClient`). Call the exposed `refresh()` after a
 * mutation.
 *
 * <DataTable :columns="[{ key: 'title', label: t('demo.notes.title'), sortable: true }]"
 *   :load="(query) => demo((client) => client.list({ urlParams: query }))" searchable>
 *   <template #title-cell="{ row }">...</template>
 *   <template #actions="{ row }">...row buttons...</template>
 *   <template #bulk-actions="{ rows, clear }">...</template>
 * </DataTable>
 */
import type { TableColumn, TableRow } from '@nuxt/ui'
import UButton from '@nuxt/ui/components/Button.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UPagination from '@nuxt/ui/components/Pagination.vue'
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue'
import UTable from '@nuxt/ui/components/Table.vue'
import EmptyState from '@opulonjs/ui/components/EmptyState'
import { computed, h, onMounted, ref, shallowRef, useSlots, watch } from 'vue'
import { EMPTY_PLACEHOLDER, getPath, humanize } from '../format.ts'
import {
  type DataTableColumn,
  type DataTableFilter,
  nextSort,
  queryRows,
  type SortState,
  type TablePage,
  type TableQuery,
} from '../table.ts'
import { useKitText } from '../text.ts'

const props = withDefaults(
  defineProps<{
    columns: ReadonlyArray<DataTableColumn<Row>>
    /** Client mode. */
    rows?: ReadonlyArray<Row>
    /** Server mode. */
    load?: (query: TableQuery) => Promise<TablePage<Row>>
    filters?: ReadonlyArray<DataTableFilter>
    searchable?: boolean
    searchPlaceholder?: string
    selectable?: boolean
    perPage?: number
    sort?: SortState | null
    emptyTitle?: string
    emptyDescription?: string
    emptyIcon?: string
    /** Accessible name of the table. */
    caption?: string
    /** Makes rows clickable (a prop, so hover styling only applies when used). */
    onRowClick?: (row: Row) => void
  }>(),
  { filters: () => [], searchable: false, selectable: false, perPage: 25, sort: null },
)

const emit = defineEmits<{ 'update:selected': [rows: Row[]] }>()
const slots = useSlots()
const text = useKitText()

const page = ref(1)
const sortState = shallowRef<SortState | null>(props.sort)
const search = ref('')
const appliedSearch = ref('')
const filterValues = ref<Record<string, string | number>>({})
const loaded = shallowRef<TablePage<Row>>({ rows: [], total: 0 })
const pending = ref(false)
const failed = ref(false)

const query = computed<TableQuery>(() => ({
  page: page.value,
  perPage: props.perPage,
  sort: sortState.value,
  search: appliedSearch.value,
  filters: filterValues.value,
}))

let latest = 0
async function refresh() {
  if (!props.load) return
  const ticket = ++latest
  pending.value = true
  failed.value = false
  try {
    const result = await props.load(query.value)
    if (ticket === latest) loaded.value = result
  } catch (error) {
    if (ticket === latest) failed.value = true
    console.error(error)
  } finally {
    if (ticket === latest) pending.value = false
  }
}
defineExpose({ refresh })

const current = computed<TablePage<Row>>(() =>
  props.load
    ? loaded.value
    : queryRows(
        props.rows ?? [],
        props.columns.map((c) => c.key),
        query.value,
      ),
)

onMounted(refresh)
watch(query, refresh)

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    appliedSearch.value = value.trim()
    page.value = 1
  }, 250)
})

function setFilter(key: string, value: string | number | undefined) {
  const next = { ...filterValues.value }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  filterValues.value = next
  page.value = 1
}
const filtered = computed(
  () => appliedSearch.value !== '' || Object.keys(filterValues.value).length > 0,
)
function resetFilters() {
  search.value = ''
  appliedSearch.value = ''
  filterValues.value = {}
  page.value = 1
}

// Selection is index-keyed and cleared whenever the visible rows change.
const rowSelection = ref<Record<string, boolean>>({})
const selected = computed(() =>
  Object.entries(rowSelection.value)
    .filter(([, on]) => on)
    .map(([index]) => current.value.rows[Number(index)])
    .filter((row): row is Row => row !== undefined),
)
watch(
  () => current.value.rows,
  () => (rowSelection.value = {}),
)
watch(selected, (rows) => emit('update:selected', rows))
const clearSelection = () => (rowSelection.value = {})

const align = { left: '', center: 'text-center', right: 'text-right' }

const header = (column: DataTableColumn<Row>) => {
  const label = column.label ?? humanize(column.key)
  if (!column.sortable) return label
  return () => {
    const direction = sortState.value?.column === column.key ? sortState.value.direction : undefined
    return h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label,
      icon: direction
        ? direction === 'asc'
          ? 'i-lucide-arrow-up-narrow-wide'
          : 'i-lucide-arrow-down-wide-narrow'
        : 'i-lucide-arrow-up-down',
      class: '-mx-2.5 font-medium',
      'aria-label': text.value.sortBy(label),
      onClick: () => {
        sortState.value = nextSort(sortState.value, column.key)
        page.value = 1
      },
    })
  }
}

const tableColumns = computed<TableColumn<Row>[]>(() => [
  ...(props.selectable
    ? [
        {
          id: 'select',
          header: ({ table }) =>
            h(UCheckbox, {
              modelValue: table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : table.getIsAllPageRowsSelected(),
              'onUpdate:modelValue': (value: unknown) => table.toggleAllPageRowsSelected(!!value),
              'aria-label': text.value.selectAll,
            }),
          cell: ({ row }) =>
            h(UCheckbox, {
              modelValue: row.getIsSelected(),
              'onUpdate:modelValue': (value: unknown) => row.toggleSelected(!!value),
              'aria-label': text.value.selectRow,
            }),
          meta: { class: { th: 'w-10', td: 'w-10' } },
        } satisfies TableColumn<Row>,
      ]
    : []),
  ...props.columns.map((column): TableColumn<Row> => ({
    id: column.key,
    accessorFn: (row) => getPath(row, column.key),
    header: header(column),
    cell: ({ row }) => {
      const value = getPath(row.original, column.key)
      if (column.format) return column.format(value, row.original)
      return value === null || value === undefined || value === ''
        ? EMPTY_PLACEHOLDER
        : String(value)
    },
    meta: {
      class: { th: align[column.align ?? 'left'], td: align[column.align ?? 'left'] },
    },
  })),
  ...(slots.actions
    ? [
        {
          id: 'actions',
          header: '',
          meta: { class: { th: 'w-px', td: 'text-right' } },
        } satisfies TableColumn<Row>,
      ]
    : []),
])

// `#<key>-cell` / `#<key>-header` slots go straight to UTable.
const forwarded = computed(() =>
  Object.keys(slots).filter((name) => name.endsWith('-cell') || name.endsWith('-header')),
)
const from = computed(() => (current.value.total === 0 ? 0 : (page.value - 1) * props.perPage + 1))
const to = computed(() => Math.min(page.value * props.perPage, current.value.total))
const onSelect = (_event: Event, row: TableRow<Row>) => props.onRowClick?.(row.original)
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="searchable || filters.length || $slots.toolbar"
      class="flex flex-wrap items-center gap-2"
    >
      <UInput
        v-if="searchable"
        v-model="search"
        icon="i-lucide-search"
        :placeholder="searchPlaceholder ?? text.search"
        :aria-label="searchPlaceholder ?? text.search"
        size="sm"
        class="w-full sm:w-64"
      />
      <USelectMenu
        v-for="filter in filters"
        :key="filter.key"
        :model-value="filterValues[filter.key]"
        :items="[...filter.options]"
        value-key="value"
        label-key="label"
        :placeholder="filter.label"
        :aria-label="filter.label"
        size="sm"
        class="w-full sm:w-44"
        @update:model-value="(value: string | number | undefined) => setFilter(filter.key, value)"
      />
      <UButton
        v-if="filtered"
        color="neutral"
        variant="link"
        size="sm"
        icon="i-lucide-x"
        :label="text.resetFilters"
        @click="resetFilters"
      />
      <div class="ms-auto flex items-center gap-2">
        <slot name="toolbar" />
      </div>
    </div>

    <div
      v-if="selectable && selected.length && $slots['bulk-actions']"
      class="flex items-center gap-2"
    >
      <slot name="bulk-actions" :rows="selected" :clear="clearSelection" />
    </div>

    <slot v-if="failed" name="error" :refresh="refresh">
      <p role="alert" class="text-sm text-error">{{ text.loadFailed }}</p>
    </slot>

    <UTable
      v-model:row-selection="rowSelection"
      :data="[...current.rows]"
      :columns="tableColumns"
      :loading="pending"
      :caption="caption"
      class="rounded-lg border border-default"
      :on-select="onRowClick ? onSelect : undefined"
    >
      <template v-for="name in forwarded" :key="name" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
      <template v-if="$slots.actions" #actions-cell="{ row }">
        <div class="flex items-center justify-end gap-1">
          <slot name="actions" :row="row.original" />
        </div>
      </template>
      <template #empty>
        <EmptyState
          :title="emptyTitle ?? text.noRecords"
          :description="emptyDescription"
          :icon="emptyIcon"
        />
      </template>
    </UTable>

    <div
      v-if="current.total > perPage"
      class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"
    >
      <span>{{ text.range(from, to, current.total) }}</span>
      <UPagination v-model:page="page" :total="current.total" :items-per-page="perPage" size="sm" />
    </div>
  </div>
</template>
