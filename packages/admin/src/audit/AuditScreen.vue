<script setup lang="ts">
import { CoreGroup, auditMaxOffset, type AuditQuery, type AuditEvent } from '@opulonjs/core/api'
import {
  UButton,
  UCard,
  UFormField,
  UInput,
  type TableQuery,
  type DataTableColumn,
} from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiClient } from '../api-client.ts'
import AuditEventDetails from './AuditEventDetails.vue'

const { t } = useI18n()
const core = useApiClient(CoreGroup)
const fields = [
  'actor',
  'module',
  'action',
  'subjectType',
  'subjectId',
  'subjectLabel',
  'start',
  'end',
] as const satisfies ReadonlyArray<Exclude<keyof AuditQuery, 'page' | 'perPage'>>
const filters = reactive(Object.fromEntries(fields.map((field) => [field, ''])))
const applied = ref<AuditQuery>({})
const revision = ref(0)
const perPage = 25
const maxPage = Math.floor(auditMaxOffset / perPage) + 1
const invalid = ref<'invalidRange' | 'invalidThrough'>()
const columns = computed<ReadonlyArray<DataTableColumn<AuditEvent>>>(() => [
  { key: 'action', label: t('admin.audit.event') },
])

function apply() {
  const start = filters.start ? `${filters.start}T00:00:00.000Z` : undefined
  const endDate = filters.end ? new Date(`${filters.end}T00:00:00.000Z`) : undefined
  if (endDate) endDate.setUTCDate(endDate.getUTCDate() + 1)
  const end = endDate && Number.isFinite(endDate.getTime()) ? endDate.toISOString() : undefined
  if (endDate && endDate.getUTCFullYear() > 9999) {
    invalid.value = 'invalidThrough'
    return
  }
  invalid.value =
    (start && !Number.isFinite(Date.parse(start))) ||
    (filters.end && !end) ||
    (start && end && start >= end)
      ? 'invalidRange'
      : undefined
  if (invalid.value) return
  applied.value = {
    ...Object.fromEntries(
      fields
        .filter((field) => field !== 'start' && field !== 'end')
        .flatMap((field) => (filters[field]?.trim() ? [[field, filters[field].trim()]] : [])),
    ),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  }
  revision.value++
}

function reset() {
  for (const field of fields) filters[field] = ''
  apply()
}

const load = (query: TableQuery) =>
  core((client) =>
    client.audit({ query: { ...applied.value, page: query.page, perPage: query.perPage } }),
  )
</script>

<template>
  <section class="space-y-4">
    <PageHeader :title="t('admin.audit.title')" :description="t('admin.audit.description')" />
    <UCard>
      <form class="space-y-3" @submit.prevent="apply">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UFormField
            v-for="field in fields"
            :key="field"
            :label="t(`admin.audit.filters.${field}`)"
          >
            <UInput
              v-model="filters[field]"
              :name="field"
              :aria-label="t(`admin.audit.filters.${field}`)"
              :type="field === 'start' || field === 'end' ? 'date' : 'text'"
              :maxlength="500"
              class="w-full"
            />
          </UFormField>
        </div>
        <p class="text-sm text-muted">{{ t('admin.audit.filterHelp') }}</p>
        <p v-if="invalid" role="alert" class="text-sm text-error">
          {{ t(`admin.audit.${invalid}`) }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" :label="t('admin.audit.apply')" />
          <UButton color="neutral" variant="ghost" :label="t('admin.audit.reset')" @click="reset" />
        </div>
      </form>
    </UCard>
    <DataTable
      :key="revision"
      :columns="columns"
      :load="load"
      :per-page="perPage"
      :max-page="maxPage"
      :caption="t('admin.audit.title')"
      :empty-title="t('admin.audit.empty')"
    >
      <template #error="{ refresh }">
        <div role="alert" class="space-y-2">
          <p class="text-sm text-error">{{ t('admin.audit.failed') }}</p>
          <UButton :label="t('admin.audit.retry')" @click="refresh" />
        </div>
      </template>
      <template #pagination-limit="{ limit }">
        <p class="text-sm text-muted">{{ t('admin.audit.depthLimit', { count: limit }) }}</p>
      </template>
      <template #action-cell="{ row }"><AuditEventDetails :event="row.original" /></template>
    </DataTable>
  </section>
</template>
