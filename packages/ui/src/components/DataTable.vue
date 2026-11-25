<script setup lang="ts" generic="Row extends Record<string, unknown>">
/**
 * List table for admin screens: search, select and date-range filters, sortable columns,
 * pagination, row selection, row reorder and an empty state.
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
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UPagination from '@nuxt/ui/components/Pagination.vue'
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue'
import UTable from '@nuxt/ui/components/Table.vue'
import EmptyState from '@opulonjs/ui/components/EmptyState'
import {
  computed,
  h,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  useSlots,
  useTemplateRef,
  watch,
} from 'vue'
import { EMPTY_PLACEHOLDER, getPath, humanize } from '../format.ts'
import { latestOnly } from '../latest.ts'
import {
  type DataTableColumn,
  type DataTableDateFilter,
  type DataTableFilter,
  type DateRange,
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
    /** Each adds a From and a To day; the chosen days reach `load` as `query.dateRanges`. */
    dateFilters?: ReadonlyArray<DataTableDateFilter>
    searchable?: boolean
    searchPlaceholder?: string
    selectable?: boolean
    /**
     * Rows move by drag handle or by their Move up and Move down buttons; each move emits
     * `reorder` with the current page's rows in the new order. Server mode shows the new order
     * at once; in client mode apply it to `rows`. Saving the order is the screen's job.
     */
    reorderable?: boolean
    /** Names a row in its move buttons and in the announcement; default: the first column. */
    rowLabel?: (row: Row) => string
    perPage?: number
    /** Bounds selectable pages while preserving the true total in the range label. */
    maxPage?: number
    sort?: SortState | null
    emptyTitle?: string
    emptyDescription?: string
    emptyIcon?: string
    /** What a failed load says (with a "Try again" button); default: the kit's generic text. */
    errorMessage?: string
    /** Accessible name of the table. */
    caption?: string
    /** Makes rows clickable (a prop, so hover styling only applies when used). */
    onRowClick?: (row: Row) => void
  }>(),
  {
    filters: () => [],
    dateFilters: () => [],
    searchable: false,
    selectable: false,
    reorderable: false,
    perPage: 25,
    sort: null,
  },
)

const emit = defineEmits<{ 'update:selected': [rows: Row[]]; reorder: [rows: Row[]] }>()
const slots = useSlots()
const text = useKitText()

const page = ref(1)
const sortState = shallowRef<SortState | null>(props.sort)
const search = ref('')
const appliedSearch = ref('')
const filterValues = ref<Record<string, string | number>>({})
const dateRanges = ref<Record<string, DateRange>>({})
const loaded = shallowRef<TablePage<Row>>({ rows: [], total: 0 })
const pending = ref(false)
const failed = ref(false)

const query = computed<TableQuery>(() => ({
  page: page.value,
  perPage: props.perPage,
  sort: sortState.value,
  search: appliedSearch.value,
  filters: filterValues.value,
  dateRanges: dateRanges.value,
}))

const nextLoad = latestOnly()
async function refresh() {
  if (!props.load) return
  const latest = nextLoad()
  pending.value = true
  failed.value = false
  try {
    const result = await props.load(query.value)
    if (latest()) loaded.value = result
  } catch (error) {
    if (latest()) failed.value = true
    console.error(error)
  } finally {
    if (latest()) pending.value = false
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
function setDate(key: string, end: keyof DateRange, value: string) {
  const { [key]: range, ...rest } = dateRanges.value
  const { [end]: _, ...other } = range ?? {}
  const next = value === '' ? other : { ...other, [end]: value }
  dateRanges.value = Object.keys(next).length > 0 ? { ...rest, [key]: next } : rest
  page.value = 1
}
const filtered = computed(
  () =>
    appliedSearch.value !== '' ||
    Object.keys(filterValues.value).length > 0 ||
    Object.keys(dateRanges.value).length > 0,
)
function resetFilters() {
  search.value = ''
  appliedSearch.value = ''
  filterValues.value = {}
  dateRanges.value = {}
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

const root = useTemplateRef<HTMLElement>('root')
const announcement = ref('')
const dragged = ref<number>()
const dropTarget = ref<number>()
const labelOf = (row: Row) =>
  props.rowLabel?.(row) ?? String(getPath(row, props.columns[0]?.key ?? '') ?? '')
function move(from: number, to: number) {
  const rows = [...current.value.rows]
  const [row] = rows.splice(from, 1)
  if (!row || from === to) return
  rows.splice(to, 0, row)
  if (props.load) loaded.value = { ...loaded.value, rows }
  emit('reorder', rows)
  announcement.value = text.value.movedTo(labelOf(row), to + 1, rows.length)
}
async function step(index: number, direction: 'up' | 'down') {
  const to = direction === 'up' ? index - 1 : index + 1
  move(index, to)
  await nextTick()
  const buttons = root.value?.querySelectorAll<HTMLButtonElement>(
    `tbody tr:nth-child(${to + 1}) button[data-move]`,
  )
  const same = [...(buttons ?? [])].find((button) => button.dataset.move === direction)
  ;(same?.disabled ? [...(buttons ?? [])].find((button) => !button.disabled) : same)?.focus()
}
const rowIndex = (event: Event) => {
  const row = (event.target as Element).closest('tbody tr')
  return row?.parentElement ? [...row.parentElement.children].indexOf(row) : undefined
}
function onDragStart(event: DragEvent, index: number) {
  dragged.value = index
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  const row = (event.target as Element).closest('tr')
  if (row) event.dataTransfer.setDragImage(row, 0, 0)
}
function onDragOver(event: DragEvent) {
  const index = rowIndex(event)
  if (dragged.value === undefined || index === undefined) return
  event.preventDefault()
  dropTarget.value = index
}
function onDrop(event: DragEvent) {
  const index = rowIndex(event)
  if (dragged.value !== undefined && index !== undefined) {
    event.preventDefault()
    move(dragged.value, index)
  }
  onDragEnd()
}
function onDragEnd() {
  dragged.value = undefined
  dropTarget.value = undefined
}
const moveButton = (row: Row, index: number, direction: 'up' | 'down') =>
  h(UButton, {
    color: 'neutral',
    variant: 'ghost',
    size: 'xs',
    icon: direction === 'up' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down',
    'aria-label': text.value[direction === 'up' ? 'moveUp' : 'moveDown'](labelOf(row)),
    'data-move': direction,
    disabled: direction === 'up' ? index === 0 : index === current.value.rows.length - 1,
    onClick: (event: Event) => {
      event.stopPropagation()
      void step(index, direction)
    },
  })

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
  ...(props.reorderable
    ? [
        {
          id: 'reorder',
          header: '',
          cell: ({ row }) =>
            h('div', { class: 'flex items-center' }, [
              h(
                'span',
                {
                  draggable: 'true',
                  'aria-hidden': 'true',
                  class: 'flex cursor-grab p-1 text-dimmed hover:text-default',
                  onDragstart: (event: DragEvent) => onDragStart(event, row.index),
                  onDragend: onDragEnd,
                },
                h(UIcon, { name: 'i-lucide-grip-vertical', class: 'size-4' }),
              ),
              moveButton(row.original, row.index, 'up'),
              moveButton(row.original, row.index, 'down'),
            ]),
          meta: { class: { th: 'w-px', td: 'w-px whitespace-nowrap' } },
        } satisfies TableColumn<Row>,
      ]
    : []),
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
      class: {
        th: align[column.align ?? 'left'],
        td: [align[column.align ?? 'left'], column.nowrap ? 'whitespace-nowrap' : '']
          .filter(Boolean)
          .join(' '),
      },
    },
  })),
  ...(slots.actions
    ? [
        {
          id: 'actions',
          header: '',
          meta: { class: { th: 'w-px', td: 'text-right whitespace-nowrap' } },
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
const paginationTotal = computed(() =>
  Math.min(current.value.total, (props.maxPage ?? Infinity) * props.perPage),
)
const onSelect = (_event: Event, row: TableRow<Row>) => props.onRowClick?.(row.original)
// Nuxt UI keeps every cell on one line, so a long title or path pushes the columns after it
// out of the visible box. Cells wrap instead (long words and paths anywhere); `nowrap` columns
// opt out. Clickable rows get the pointer, the empty and loading rows do not.
const tableMeta = computed(() => ({
  class: {
    tr: (row: { index: number }) => (row.index === dropTarget.value ? 'bg-elevated' : ''),
  },
}))
const tableUi = computed(() => ({
  td: 'whitespace-normal [overflow-wrap:anywhere]',
  tbody: props.onRowClick ? '[&>tr:has(>[data-slot=td])]:cursor-pointer' : undefined,
  empty: failed.value ? 'p-0' : undefined,
}))
</script>

<template>
  <div ref="root" class="space-y-3">
    <div
      v-if="searchable || filters.length || dateFilters.length || $slots.toolbar"
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
      <div
        v-for="filter in dateFilters"
        :key="filter.key"
        class="flex items-center gap-1 text-sm text-muted"
      >
        <span>{{ filter.label }}</span>
        <UInput
          type="date"
          :model-value="dateRanges[filter.key]?.from ?? ''"
          :max="dateRanges[filter.key]?.to"
          :aria-label="text.rangeFrom(filter.label)"
          size="sm"
          @update:model-value="(value: string) => setDate(filter.key, 'from', value)"
        />
        <span aria-hidden="true">–</span>
        <UInput
          type="date"
          :model-value="dateRanges[filter.key]?.to ?? ''"
          :min="dateRanges[filter.key]?.from"
          :aria-label="text.rangeTo(filter.label)"
          size="sm"
          @update:model-value="(value: string) => setDate(filter.key, 'to', value)"
        />
      </div>
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
      <div role="alert" class="flex flex-wrap items-center gap-2 text-sm text-error">
        <span>{{ errorMessage ?? text.loadFailed }}</span>
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          icon="i-lucide-rotate-cw"
          :label="text.retry"
          @click="refresh"
        />
      </div>
    </slot>

    <p v-if="reorderable" class="sr-only" aria-live="polite">{{ announcement }}</p>

    <UTable
      v-model:row-selection="rowSelection"
      :data="[...current.rows]"
      :columns="tableColumns"
      :loading="pending"
      :caption="caption"
      :ui="tableUi"
      :meta="tableMeta"
      class="rounded-lg border border-default"
      :on-select="onRowClick ? onSelect : undefined"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <template v-for="name in forwarded" :key="name" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
      <template v-if="$slots.actions" #actions-cell="{ row }">
        <div class="flex items-center justify-end gap-1">
          <slot name="actions" :row="row.original" />
        </div>
      </template>
      <template #loading>
        <p class="py-6 text-center text-sm text-muted" role="status">{{ text.loading }}</p>
      </template>
      <template #empty>
        <template v-if="!failed">
          <EmptyState v-if="filtered" :title="text.noMatches" icon="i-lucide-search-x">
            <template #actions>
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-x"
                :label="text.resetFilters"
                @click="resetFilters"
              />
            </template>
          </EmptyState>
          <EmptyState
            v-else
            :title="emptyTitle ?? text.noRecords"
            :description="emptyDescription"
            :icon="emptyIcon"
          />
        </template>
      </template>
    </UTable>

    <slot
      v-if="current.total > paginationTotal"
      name="pagination-limit"
      :total="current.total"
      :limit="paginationTotal"
    />

    <div
      v-if="current.total > perPage"
      class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"
    >
      <span>{{ text.range(from, to, current.total) }}</span>
      <UPagination
        v-model:page="page"
        :total="paginationTotal"
        :items-per-page="perPage"
        size="sm"
      />
    </div>
  </div>
</template>
