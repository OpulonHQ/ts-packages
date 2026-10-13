<script setup lang="ts">
import { useApiClient, useI18n } from '@opulonjs/admin'
import type { TablePage, TableQuery } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { ref } from 'vue'
import { type EmailLogEntry, EmailsGroup, emailStatuses } from '../api.ts'

const { t, locale } = useI18n()
const emails = useApiClient(EmailsGroup)
const failed = ref(false)

const isStatus = (v: unknown): v is EmailLogEntry['status'] => emailStatuses.some((s) => s === v)

async function load(query: TableQuery): Promise<TablePage<EmailLogEntry>> {
  const status = query.filters.status
  try {
    const page = await emails((client) =>
      client.log({
        query: {
          page: query.page,
          perPage: query.perPage,
          ...(isStatus(status) ? { status } : {}),
        },
      }),
    )
    failed.value = false
    return page
  } catch {
    failed.value = true
    return { rows: [], total: 0 }
  }
}

const columns = [
  {
    key: 'createdAt',
    label: t('emails.log.columns.createdAt'),
    format: (value: unknown) => new Date(String(value)).toLocaleString(locale.value),
  },
  { key: 'templateKey', label: t('emails.log.columns.templateKey') },
  {
    key: 'recipients',
    label: t('emails.log.columns.recipients'),
    format: (value: unknown) => (Array.isArray(value) ? value.join(', ') : ''),
  },
  { key: 'subject', label: t('emails.log.columns.subject') },
  { key: 'status', label: t('emails.log.columns.status') },
  { key: 'attempts', label: t('emails.log.columns.attempts'), align: 'right' as const },
]

const statusFilter = {
  key: 'status',
  label: t('emails.log.columns.status'),
  options: emailStatuses.map((value) => ({ value, label: t(`emails.log.status.${value}`) })),
}
</script>

<template>
  <section>
    <PageHeader :title="t('emails.log.title')" :description="t('emails.log.description')" />
    <p v-if="failed" role="alert" class="text-error">{{ t('emails.log.failed') }}</p>
    <DataTable
      :load="load"
      :columns="columns"
      :filters="[statusFilter]"
      :empty-title="t('emails.log.empty')"
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
