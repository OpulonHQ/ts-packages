<script setup lang="ts">
import { RouterLink, useApiClient, useI18n, useRouter } from '@opulonjs/admin'
import { languageName, queryRows, type TablePage, type TableQuery } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed } from 'vue'
import { type EmailTemplateInfo, EmailsGroup } from '../api.ts'

const { t, locale } = useI18n()
const router = useRouter()
const emails = useApiClient(EmailsGroup)

const load = async (query: TableQuery): Promise<TablePage<EmailTemplateInfo>> =>
  queryRows([...(await emails((client) => client.templates())).templates], ['key'], query)

const open = (row: EmailTemplateInfo) =>
  router.push({ name: 'emails.template', params: { key: row.key } })

const columns = computed(() => [
  { key: 'key', label: t('emails.templates.columns.key'), sortable: true },
  {
    key: 'audience',
    label: t('emails.templates.columns.audience'),
    nowrap: true,
    format: (value: unknown) => t(`emails.templates.audience.${String(value)}`),
  },
  {
    key: 'placeholders',
    label: t('emails.templates.columns.placeholders'),
    format: (value: unknown) =>
      (value as EmailTemplateInfo['placeholders']).map((p) => `{{${p.name}}}`).join(' '),
  },
  {
    key: 'locales',
    label: t('emails.templates.columns.locales'),
    format: (value: unknown) =>
      (value as EmailTemplateInfo['locales'])
        .map(
          (l) =>
            `${languageName(l.locale, locale.value)}: ${t(l.override ? 'emails.templates.overridden' : 'emails.templates.default')}`,
        )
        .join(', '),
  },
  { key: 'enabled', label: t('emails.templates.columns.enabled'), nowrap: true },
])
</script>

<template>
  <section>
    <PageHeader
      :title="t('emails.templates.title')"
      :description="t('emails.templates.description')"
    />
    <DataTable
      :load="load"
      :columns="columns"
      :empty-title="t('emails.templates.empty')"
      :error-message="t('emails.templates.failed')"
      :caption="t('emails.templates.title')"
      searchable
      :on-row-click="open"
    >
      <template #key-cell="{ row }">
        <RouterLink
          :to="{ name: 'emails.template', params: { key: row.original.key } }"
          class="font-medium text-highlighted hover:underline"
          @click.stop
        >
          {{ row.original.key }}
        </RouterLink>
      </template>
      <template #enabled-cell="{ row }">
        <StatusBadge
          :status="row.original.enabled ? 'enabled' : 'disabled'"
          :label="
            t(row.original.enabled ? 'emails.templates.enabled' : 'emails.templates.disabled')
          "
        />
      </template>
    </DataTable>
  </section>
</template>
