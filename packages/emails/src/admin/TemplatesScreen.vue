<script setup lang="ts">
import { RouterLink, useApiClient, useI18n } from '@opulonjs/admin'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { ref } from 'vue'
import { type EmailTemplateInfo, EmailsGroup } from '../api.ts'

const { t } = useI18n()
const emails = useApiClient(EmailsGroup)
const templates = ref<Array<EmailTemplateInfo>>()
const failed = ref(false)

emails((client) => client.templates()).then(
  (list) => (templates.value = [...list.templates]),
  () => (failed.value = true),
)

const columns = [
  { key: 'key', label: t('emails.templates.columns.key'), sortable: true },
  {
    key: 'audience',
    label: t('emails.templates.columns.audience'),
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
            `${l.locale}: ${t(l.override ? 'emails.templates.overridden' : 'emails.templates.default')}`,
        )
        .join(', '),
  },
  { key: 'enabled', label: t('emails.templates.columns.enabled') },
]
</script>

<template>
  <section>
    <PageHeader
      :title="t('emails.templates.title')"
      :description="t('emails.templates.description')"
    />
    <p v-if="failed" role="alert" class="text-error">{{ t('emails.templates.failed') }}</p>
    <DataTable
      v-else-if="templates"
      :rows="templates"
      :columns="columns"
      :empty-title="t('emails.templates.empty')"
      :caption="t('emails.templates.title')"
      searchable
    >
      <template #key-cell="{ row }">
        <RouterLink
          :to="{ name: 'emails.template', params: { key: row.original.key } }"
          class="font-medium text-primary hover:underline"
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
