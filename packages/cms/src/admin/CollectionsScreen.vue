<script setup lang="ts">
import { CachePurgeNotice, useI18n, useNavTarget } from '@opulonjs/admin'
import { listDefaultPerPage, listMaxOffset, listMaxPerPage } from '@opulonjs/core/api'
import { formatDate, type SelectItem, type TableQuery, UButton } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { type ItemSummary, labelText } from '../api.ts'
import { failureMessage, useCmsContext, useContent } from './use-cms.ts'

const { t, locale } = useI18n()
const content = useContent()
const { definitions } = useCmsContext()
const route = useRoute()
const router = useRouter()
const creating = ref(false)
const failure = ref<string>()

const keys = Object.keys(definitions.collections)
const current = computed(() => {
  const wanted = String(route.params.collection ?? '')
  return keys.includes(wanted) ? wanted : keys[0]
})
useNavTarget(() =>
  current.value === undefined
    ? undefined
    : { route: 'cms.collections', params: { collection: current.value } },
)
const collection = computed(() =>
  current.value === undefined ? undefined : definitions.collections[current.value],
)

const referenceItems = shallowRef<Readonly<Record<string, ReadonlyArray<SelectItem>>>>({})
let latest = 0
watch(
  collection,
  async (definition) => {
    const ticket = ++latest
    referenceItems.value = {}
    for (const name of definition?.filters ?? []) {
      const target = definition?.fields[name]?.collection
      if (target === undefined) continue
      try {
        const { rows } = await content.listItems(target, {
          perPage: listMaxPerPage,
          sort: 'title',
          direction: 'asc',
        })
        if (ticket !== latest) return
        referenceItems.value = {
          ...referenceItems.value,
          [name]: rows.map((row) => ({ label: row.title, value: row.id })),
        }
      } catch (error) {
        if (ticket === latest) failure.value = failureMessage(error, t('cms.errors.failed'))
        return
      }
    }
  },
  { immediate: true },
)
const filters = computed(() =>
  (collection.value?.filters ?? []).flatMap((name) => {
    const field = collection.value?.fields[name]
    if (!field) return []
    return [
      {
        key: name,
        label: labelText(field.label, locale.value),
        options:
          field.kind === 'select'
            ? (field.options ?? []).map((option) => ({
                label: labelText(option.label, locale.value),
                value: option.value,
              }))
            : (referenceItems.value[name] ?? []),
      },
    ]
  }),
)

const load = async (query: TableQuery) => {
  if (!current.value) return { rows: [], total: 0 }
  const sort = query.sort?.column
  return content.listItems(current.value, {
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    filter: Object.entries(query.filters).map(([name, value]) => `${name}:${value}`),
    ...(sort === 'title' || sort === 'path' || sort === 'status' || sort === 'updatedAt'
      ? { sort }
      : {}),
    ...(query.sort ? { direction: query.sort.direction } : {}),
  })
}
const columns = computed(() => [
  { key: 'title', label: t('cms.columns.title'), sortable: true },
  ...(collection.value?.routed
    ? [{ key: 'path', label: t('cms.columns.path'), sortable: true }]
    : []),
  { key: 'status', label: t('cms.columns.status'), sortable: true, nowrap: true },
  {
    key: 'updatedAt',
    sortable: true,
    nowrap: true,
    label: t('cms.columns.updatedAt'),
    format: (v: unknown) => formatDate(v, locale.value),
  },
])

const open = (item: Pick<ItemSummary, 'id'>) =>
  router.push({ name: 'cms.item', params: { id: item.id } })

async function create() {
  if (!current.value) return
  creating.value = true
  failure.value = undefined
  try {
    await open(await content.createItem(current.value, { locales: {}, data: {} }))
  } catch (error) {
    failure.value = failureMessage(error, t('cms.errors.failed'))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section>
    <PageHeader
      :title="collection ? labelText(collection.label, locale) : t('cms.collections.title')"
      :description="t('cms.collections.description')"
    >
      <template v-if="collection && content.can('cms.collections.edit')" #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('cms.collections.create')"
          :loading="creating"
          @click="create"
        />
      </template>
    </PageHeader>
    <CachePurgeNotice class="mb-4" />
    <p v-if="failure" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
    <DataTable
      v-if="collection"
      :key="current"
      :columns="columns"
      :load="load"
      :filters="filters"
      :per-page="listDefaultPerPage"
      :max-page="Math.floor(listMaxOffset / listDefaultPerPage) + 1"
      :caption="labelText(collection.label, locale)"
      :empty-title="t('cms.collections.empty')"
      searchable
      :on-row-click="open"
    >
      <template #pagination-limit>{{ t('cms.collections.paginationLimit') }}</template>
      <template #title-cell="{ row }">
        <span class="font-medium text-highlighted">{{ row.original.title }}</span>
      </template>
      <template #status-cell="{ row }">
        <StatusBadge
          :status="row.original.status"
          :label="t(`cms.status.${row.original.status}`)"
          :color="row.original.status === 'changed' ? 'warning' : undefined"
        />
      </template>
    </DataTable>
  </section>
</template>
