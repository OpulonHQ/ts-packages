<script setup lang="ts">
import { useApiClient, useI18n, useUnsavedChanges } from '@opulonjs/admin'
import { formatDate, UForm } from '@opulonjs/ui'
import DataTable from '@opulonjs/ui/components/DataTable'
import FieldDate from '@opulonjs/ui/components/Field/Date'
import FieldDateTime from '@opulonjs/ui/components/Field/DateTime'
import FieldFile from '@opulonjs/ui/components/Field/File'
import FieldMoney from '@opulonjs/ui/components/Field/Money'
import FieldRelation from '@opulonjs/ui/components/Field/Relation'
import FieldToggle from '@opulonjs/ui/components/Field/Toggle'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { ref, useTemplateRef } from 'vue'
import { DemoGroup } from '../api.ts'

const { t, locale } = useI18n()
const demo = useApiClient(DemoGroup)

interface Values {
  dueOn: string | null
  publishAt: string | null
  price: number | null
  scan: File | null
  noteId: number | null
}
const blank = (): Values => ({
  dueOn: null,
  publishAt: null,
  price: null,
  scan: null,
  noteId: null,
})
const draft = ref(blank())
const saved = ref(blank())
const locked = ref(false)
const done = ref(false)
const form = useTemplateRef('form')

useUnsavedChanges({
  current: () => draft.value,
  saved: () => saved.value,
  save: () => form.value?.submit(),
  discard: () => (draft.value = { ...saved.value }),
})
const validate = (values: Partial<Values>) =>
  values.dueOn ? [] : [{ name: 'dueOn', message: t('demo.kit.required') }]
function save() {
  saved.value = { ...draft.value }
  done.value = true
}
const searchNotes = async (term: string) =>
  (await demo((client) => client.searchNotes({ query: { q: term } }))).map((note) => ({
    label: note.body,
    value: note.id,
  }))

const tasks = ref([
  { id: 1, title: 'Draft the contract', due: '2026-11-03' },
  { id: 2, title: 'Collect signatures', due: '2026-11-12' },
  { id: 3, title: 'File the deed', due: '2026-11-21' },
  { id: 4, title: 'Send the invoice', due: '2026-12-01' },
])
</script>

<template>
  <section class="space-y-8">
    <PageHeader :title="t('demo.kit.title')" :description="t('demo.kit.description')" />

    <UForm
      ref="form"
      :state="draft"
      :validate="validate"
      class="grid max-w-3xl gap-4 sm:grid-cols-2"
      @submit="save"
    >
      <FieldDate
        v-model="draft.dueOn"
        name="dueOn"
        :label="t('demo.kit.dueOn')"
        :disabled="locked"
        required
      />
      <FieldDateTime
        v-model="draft.publishAt"
        name="publishAt"
        :label="t('demo.kit.publishAt')"
        :disabled="locked"
      />
      <FieldMoney
        v-model="draft.price"
        name="price"
        currency="EUR"
        :label="t('demo.kit.price')"
        :disabled="locked"
      />
      <FieldRelation
        v-model="draft.noteId"
        name="noteId"
        :label="t('demo.kit.note')"
        :search="searchNotes"
        :disabled="locked"
      />
      <FieldFile
        v-model="draft.scan"
        name="scan"
        accept="application/pdf,image/*"
        :max-size="1024 * 1024"
        :label="t('demo.kit.scan')"
        :help="t('demo.kit.scanHelp')"
        :disabled="locked"
        class="sm:col-span-2"
      />
      <FieldToggle v-model="locked" name="locked" :label="t('demo.kit.locked')" />
    </UForm>
    <p v-if="done" role="status">{{ t('demo.kit.saved') }}</p>

    <dl :aria-label="t('demo.kit.values')" class="grid max-w-xl grid-cols-2 gap-x-4 text-sm">
      <dt>{{ t('demo.kit.dueOn') }}</dt>
      <dd data-value="dueOn">{{ draft.dueOn ?? t('demo.kit.none') }}</dd>
      <dt>{{ t('demo.kit.publishAt') }}</dt>
      <dd data-value="publishAt">{{ draft.publishAt ?? t('demo.kit.none') }}</dd>
      <dt>{{ t('demo.kit.minorUnits') }}</dt>
      <dd data-value="price">{{ draft.price ?? t('demo.kit.none') }}</dd>
      <dt>{{ t('demo.kit.file') }}</dt>
      <dd data-value="scan">
        {{
          draft.scan
            ? `${draft.scan.name}, ${draft.scan.size} B, ${draft.scan.type}`
            : t('demo.kit.none')
        }}
      </dd>
      <dt>{{ t('demo.kit.noteId') }}</dt>
      <dd data-value="noteId">{{ draft.noteId ?? t('demo.kit.none') }}</dd>
    </dl>

    <DataTable
      :rows="tasks"
      :columns="[
        { key: 'title', label: t('demo.kit.task') },
        {
          key: 'due',
          label: t('demo.kit.due'),
          nowrap: true,
          format: (value) => formatDate(value, locale),
        },
      ]"
      :date-filters="[{ key: 'due', label: t('demo.kit.due') }]"
      :caption="t('demo.kit.tasks')"
      reorderable
      @reorder="(rows) => (tasks = rows)"
    />
    <p data-value="order">
      {{ t('demo.kit.order') }}: {{ tasks.map((task) => task.title).join(', ') }}
    </p>
  </section>
</template>
