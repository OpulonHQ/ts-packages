<script setup lang="ts">
import { useApiClient, useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { ref } from 'vue'
import { DemoGroup } from '../api.ts'

const { t } = useI18n()
const demo = useApiClient(DemoGroup)
const notes = ref<Array<{ id: number; body: string }>>()
const failed = ref(false)
const stampFailed = ref(false)

demo((client) => client.notes()).then(
  (rows) => (notes.value = [...rows]),
  () => (failed.value = true),
)

function stamp() {
  stampFailed.value = false
  demo((client) => client.stamp()).then(
    (note) => notes.value?.push(note),
    () => (stampFailed.value = true),
  )
}
</script>

<template>
  <section>
    <PageHeader :title="t('demo.notes.title')" :description="t('demo.notes.description')" />
    <UButton :label="t('demo.notes.stamp')" @click="stamp" />
    <p v-if="stampFailed" role="alert" class="text-error">{{ t('demo.notes.stampFailed') }}</p>
    <p v-if="failed" role="alert" class="text-error">{{ t('demo.notes.failed') }}</p>
    <DataTable
      v-else-if="notes"
      :rows="notes"
      :columns="[{ key: 'body', label: t('demo.notes.body'), sortable: true }]"
      :empty-title="t('demo.notes.empty')"
      :caption="t('demo.notes.title')"
      searchable
    />
  </section>
</template>
