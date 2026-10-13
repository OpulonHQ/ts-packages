<script setup lang="ts">
/** Content > Collections: the host's collections as tabs, the chosen one's items below. */
import { useI18n } from '@opulonjs/admin'
import { queryRows, type TableQuery, UButton } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed, ref } from 'vue'
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
const collection = computed(() =>
  current.value === undefined ? undefined : definitions.collections[current.value],
)

const load = async (query: TableQuery) =>
  queryRows(
    current.value ? (await content.listItems(current.value)).rows : [],
    ['title', 'path'],
    query,
  )
const columns = computed(() => [
  { key: 'title', label: t('cms.columns.title') },
  ...(collection.value?.routed ? [{ key: 'path', label: t('cms.columns.path') }] : []),
  { key: 'status', label: t('cms.columns.status') },
  {
    key: 'updatedAt',
    label: t('cms.columns.updatedAt'),
    format: (v: unknown) => new Date(String(v)).toLocaleDateString(locale.value),
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
    <PageHeader :title="t('cms.collections.title')" :description="t('cms.collections.description')">
      <template v-if="collection && content.can('cms.collections.edit')" #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('cms.collections.create')"
          :loading="creating"
          @click="create"
        />
      </template>
    </PageHeader>
    <nav class="mb-4 flex flex-wrap gap-2" :aria-label="t('cms.collections.title')">
      <UButton
        v-for="key in keys"
        :key="key"
        :to="{ name: 'cms.collections', params: { collection: key } }"
        :label="labelText(definitions.collections[key]!.label, locale)"
        :variant="key === current ? 'solid' : 'outline'"
        color="neutral"
        :aria-current="key === current ? 'page' : undefined"
      />
    </nav>
    <p v-if="failure" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
    <DataTable
      v-if="collection"
      :key="current"
      :columns="columns"
      :load="load"
      :caption="labelText(collection.label, locale)"
      :empty-title="t('cms.collections.empty')"
      searchable
      :on-row-click="open"
    >
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
