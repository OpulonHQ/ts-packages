<script setup lang="ts">
/** Content > Pages: every page with its path and publish status; system pages first. */
import { CachePurgeNotice, useI18n } from '@opulonjs/admin'
import { queryRows, type TableQuery, UButton, UModal } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { labelText, type PageSummary, type PageTemplate } from '../api.ts'
import { failureMessage, pageTitle, useCmsContext, usePages } from './use-cms.ts'

const { t, locale } = useI18n()
const pages = usePages()
const { definitions } = useCmsContext()
const router = useRouter()
const creating = ref(false)
const picking = ref(false)
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

const templates = Object.entries(definitions.templates)
const choices = computed(() => [
  {
    key: '',
    label: t('cms.pages.blank'),
    description: t('cms.pages.blankDescription'),
    types: '',
    sections: [],
  },
  ...templates.map(([key, template]) => ({
    key,
    label: labelText(template.label, locale.value),
    description: labelText(template.description, locale.value),
    types: t('cms.pages.templateSections', {
      sections: template.sections
        .map((s) => labelText(definitions.sections[s.type]?.label, locale.value))
        .join(', '),
    }),
    sections: template.sections,
  })),
])

const open = (page: PageSummary) => router.push({ name: 'cms.page', params: { id: page.id } })

async function create(sections: PageTemplate['sections'] = []) {
  creating.value = true
  failure.value = undefined
  try {
    const page = await pages.create({
      locales: {},
      sections: sections.map(({ type, data = {} }) => ({ id: crypto.randomUUID(), type, data })),
    })
    await open(page)
  } catch (error) {
    failure.value = failureMessage(error, t('cms.errors.failed'))
  } finally {
    creating.value = false
  }
}

const start = () => (templates.length > 0 ? (picking.value = true) : create())
</script>

<template>
  <section>
    <PageHeader :title="t('cms.pages.title')" :description="t('cms.pages.description')">
      <template v-if="pages.can('cms.pages.edit')" #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('cms.pages.create')"
          :loading="creating"
          @click="start"
        />
      </template>
    </PageHeader>
    <CachePurgeNotice class="mb-4" />
    <p v-if="failure && !picking" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
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
    <UModal
      v-model:open="picking"
      :title="t('cms.pages.create')"
      :description="t('cms.pages.pick')"
      :dismissible="!creating"
      :close="!creating"
    >
      <template #body>
        <p v-if="failure" role="alert" class="mb-3 text-sm text-error">{{ failure }}</p>
        <ul class="grid gap-2">
          <li v-for="choice in choices" :key="choice.key">
            <UButton
              color="neutral"
              variant="outline"
              block
              class="flex-col items-start gap-0.5 text-start"
              :disabled="creating"
              @click="create(choice.sections)"
            >
              <span class="font-medium text-highlighted">{{ choice.label }}</span>
              <span class="text-sm font-normal text-muted">{{ choice.description }}</span>
              <span v-if="choice.types" class="text-xs font-normal text-dimmed">
                {{ choice.types }}
              </span>
            </UButton>
          </li>
        </ul>
      </template>
    </UModal>
  </section>
</template>
