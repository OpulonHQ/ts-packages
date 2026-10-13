<script setup lang="ts">
/** Content > Media: the flat library with search, type and archived filters, upload and details. */
import { CachePurgeNotice, useI18n } from '@opulonjs/admin'
import { UButton, UIcon, USlideover } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref, shallowRef } from 'vue'
import type { MediaItem } from '../api.ts'
import MediaDetails from './MediaDetails.vue'
import { accept, failureMessage, formatSize, useMedia } from './use-media.ts'

const { t, locale } = useI18n()
const media = useMedia()
const table = ref<{ refresh: () => void }>()
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const failure = ref<string>()
const selected = shallowRef<MediaItem>()
const open = computed({
  get: () => selected.value !== undefined,
  set: (value) => {
    if (!value) selected.value = undefined
  },
})

const load = media.load()
const columns = computed(() => [
  { key: 'preview', label: t('media.columns.preview') },
  { key: 'filename', label: t('media.columns.filename') },
  { key: 'mime', label: t('media.columns.type') },
  {
    key: 'size',
    label: t('media.columns.size'),
    format: (v: unknown) => formatSize(Number(v), locale.value),
  },
  {
    key: 'updatedAt',
    label: t('media.columns.updatedAt'),
    format: (v: unknown) => new Date(String(v)).toLocaleDateString(locale.value),
  },
])
const filters = computed(() => [
  {
    key: 'type',
    label: t('media.filters.type'),
    options: [
      { label: t('media.filters.image'), value: 'image' },
      { label: t('media.filters.pdf'), value: 'pdf' },
    ],
  },
  {
    key: 'status',
    label: t('media.filters.status'),
    options: [
      { label: t('media.filters.active'), value: 'active' },
      { label: t('media.filters.archived'), value: 'archived' },
    ],
  },
])

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  uploading.value = true
  failure.value = undefined
  try {
    for (const file of files) selected.value = await media.upload(file)
  } catch (error) {
    failure.value = failureMessage(error, t('media.errors.failed'))
  } finally {
    uploading.value = false
    table.value?.refresh()
  }
}

function changed(item: MediaItem) {
  selected.value = item
  table.value?.refresh()
}
</script>

<template>
  <section>
    <PageHeader :title="t('media.library.title')" :description="t('media.library.description')">
      <template v-if="media.can('media.upload')" #actions>
        <UButton
          icon="i-lucide-upload"
          :label="t('media.library.upload')"
          :loading="uploading"
          @click="fileInput?.click()"
        />
        <input
          ref="fileInput"
          type="file"
          multiple
          class="sr-only"
          tabindex="-1"
          :aria-label="t('media.library.upload')"
          :accept="accept()"
          @change="upload"
        />
      </template>
    </PageHeader>
    <CachePurgeNotice
      v-if="!selected && (media.can('media.upload') || media.can('media.archive'))"
      :pending="uploading"
      class="mb-4"
    />
    <p v-if="failure" role="alert" class="mb-4 text-sm text-error">{{ failure }}</p>
    <DataTable
      ref="table"
      :columns="columns"
      :load="load"
      :filters="filters"
      :caption="t('media.library.caption')"
      :empty-title="t('media.library.empty')"
      searchable
      :on-row-click="(row: MediaItem) => (selected = row)"
    >
      <template #preview-cell="{ row }">
        <img
          v-if="row.original.mime !== 'application/pdf'"
          :src="row.original.url"
          alt=""
          loading="lazy"
          class="size-12 rounded bg-elevated object-cover"
        />
        <UIcon v-else name="i-lucide-file-text" class="size-8 text-muted" />
      </template>
    </DataTable>

    <USlideover v-model:open="open" :title="t('media.details.title')">
      <template #body>
        <MediaDetails v-if="selected" :item="selected" @changed="changed" />
      </template>
    </USlideover>
  </section>
</template>
