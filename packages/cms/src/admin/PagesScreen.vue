<script setup lang="ts">
/** Content > Pages: every page with its path and publish status; system pages first. */
import { useI18n } from '@opulonjs/admin'
import { queryRows, type TableQuery, UButton } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { PageSummary } from '../api.ts'
import { failureMessage, pageTitle, useCmsContext, usePages } from './use-cms.ts'

const { t, locale } = useI18n()
const pages = usePages()
const { definitions } = useCmsContext()
const router = useRouter()
const creating = ref(false)
const failure = ref<string>()

const load = async (query: TableQuery) => {
  const rows = (await pages.list()).rows.map((row) => ({
    ...row,
    title: pageTitle(definitions, row, locale.value),
  }))
  return queryRows(rows, ['title', 'path'], query)
}
const columns = computed(() => [
  { key: 'title', label: t('cms.columns.title') },
  { key: 'path', label: t('cms.columns.path') },
  { key: 'status', label: t('cms.columns.status') },
  {
    key: 'updatedAt',
    label: t('cms.columns.updatedAt'),
    format: (v: unknown) => new Date(String(v)).toLocaleDateString(locale.value),
  },
])

const open = (page: PageSummary) => router.push({ name: 'cms.page', params: { id: page.id } })

async function create() {
  creating.value = true
  failure.value = undefined
  try {
    await open(await pages.create({ locales: {}, sections: [] }))
  } catch (error) {
    failure.value = failureMessage(error, t('cms.errors.failed'))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section>
    <PageHeader :title="t('cms.pages.title')" :description="t('cms.pages.description')">
      <template v-if="pages.can('cms.pages.edit')" #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('cms.pages.create')"
          :loading="creating"
          @click="create"
        />
      </template>
    </PageHeader>
    <p v-if="failure" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
    <DataTable
      :columns="columns"
      :load="load"
      :caption="t('cms.pages.caption')"
      :empty-title="t('cms.pages.empty')"
      searchable
      :on-row-click="open"
    >
      <template #title-cell="{ row }">
        <span class="font-medium text-highlighted">{{ row.original.title }}</span>
        <span v-if="row.original.systemKey" class="ms-2 text-xs text-muted">
          {{ t('cms.page.system') }}
        </span>
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
