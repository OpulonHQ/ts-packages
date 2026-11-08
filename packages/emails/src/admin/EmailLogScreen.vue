<script setup lang="ts">
import { useApiClient, useI18n } from '@opulonjs/admin'
import { formatDateTime, type TablePage, type TableQuery } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { computed } from 'vue'
import { type EmailLogEntry, EmailsGroup, emailStatuses } from '../api.ts'

const { t, locale } = useI18n()
const emails = useApiClient(EmailsGroup)

const isStatus = (v: unknown): v is EmailLogEntry['status'] => emailStatuses.some((s) => s === v)

const load = (query: TableQuery): Promise<TablePage<EmailLogEntry>> => {
  const status = query.filters.status
  return emails((client) =>
    client.log({
      query: {
        page: query.page,
        perPage: query.perPage,
        ...(isStatus(status) ? { status } : {}),
      },
    }),
  )
}

const columns = computed(() => [
  {
    key: 'createdAt',
    label: t('emails.log.columns.createdAt'),
    nowrap: true,
    format: (value: unknown) => formatDateTime(value, locale.value),
  },
  { key: 'templateKey', label: t('emails.log.columns.templateKey') },
  {
    key: 'recipients',
    label: t('emails.log.columns.recipients'),
    format: (value: unknown) => (Array.isArray(value) ? value.join(', ') : ''),
  },
  { key: 'subject', label: t('emails.log.columns.subject') },
  { key: 'status', label: t('emails.log.columns.status'), nowrap: true },
  {
    key: 'attempts',
    label: t('emails.log.columns.attempts'),
    align: 'right' as const,
    nowrap: true,
  },
])

const statusFilter = computed(() => ({
  key: 'status',
  label: t('emails.log.columns.status'),
  options: emailStatuses.map((value) => ({ value, label: t(`emails.log.status.${value}`) })),
}))
</script>

<template>
  <section>
    <PageHeader :title="t('emails.log.title')" :description="t('emails.log.description')" />
    <DataTable
      :load="load"
      :columns="columns"
      :filters="[statusFilter]"
      :empty-title="t('emails.log.empty')"
      :error-message="t('emails.log.failed')"
      :caption="t('emails.log.title')"
    >
      <template #status-cell="{ row }">
        <StatusBadge
          :status="row.original.status"
          :label="t(`emails.log.status.${row.original.status}`)"
        />
      </template>
    </DataTable>
  </section>
</template>
