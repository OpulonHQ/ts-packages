<script setup lang="ts">
import { CachePurgeNotice, useCloseGuard, useI18n, useUnsavedChanges } from '@opulonjs/admin'
import { queryRows, type TableQuery, UButton, USlideover } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import DataTable from '@opulonjs/ui/components/DataTable'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import FieldText from '@opulonjs/ui/components/Field/Text'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref, shallowRef, useId } from 'vue'
import type { Redirect, RedirectImportResult, RedirectInput } from '../api.ts'
import { failureMessage, useRedirects } from './use-cms.ts'

interface RedirectForm {
  id?: string
  input: RedirectInput
}

const { t } = useI18n()
const redirects = useRedirects()
const canEdit = computed(() => redirects.can('cms.redirects.edit'))
const table = ref<{ refresh: () => void }>()
const fileInput = ref<HTMLInputElement>()
const pending = ref(false)
const status = ref<{ kind: 'ok' | 'error'; message: string }>()
const imported = ref<RedirectImportResult>()
const confirming = ref(false)
const editing = ref<RedirectForm>()
const opened = shallowRef<RedirectForm>()
const formId = useId()

const changes = useUnsavedChanges({
  current: () => editing.value,
  saved: () => opened.value,
  save: () => save(),
  discard: () => (editing.value = opened.value && structuredClone(opened.value)),
  busy: () => pending.value,
  bar: false,
  within: () => document.getElementById(formId),
})
const { open, dismissible, close, leave } = useCloseGuard({
  isOpen: () => editing.value !== undefined,
  close: () => show(undefined),
  dirty: () => changes.dirty.value,
})

const load = async (query: TableQuery) =>
  queryRows([...(await redirects.list()).rows], ['from', 'to'], query)
const columns = computed(() => [
  { key: 'from', label: t('cms.redirects.from') },
  { key: 'to', label: t('cms.redirects.to') },
  { key: 'status', label: t('cms.redirects.status'), nowrap: true },
  ...(redirects.contentLocales.value.length > 1
    ? [{ key: 'locale', label: t('cms.redirects.locale'), nowrap: true }]
    : []),
])
const statuses = computed(() => [
  { label: t('cms.redirects.permanent'), value: 301 },
  { label: t('cms.redirects.temporary'), value: 302 },
])

function show(form: RedirectForm | undefined) {
  status.value = undefined
  editing.value = form
  opened.value = form && structuredClone(form)
}
async function startCreate() {
  if (!(await leave())) return
  const locale = redirects.contentLocales.value[0] ?? ''
  show({ input: { locale, from: '', to: '', status: 301 } })
}
async function startEdit(redirect: Redirect) {
  if (!canEdit.value || !(await leave())) return
  const { id, locale, from, to, status: code } = redirect
  show({ id, input: { locale, from, to, status: code } })
}

async function run(action: () => Promise<unknown>, done: string) {
  pending.value = true
  status.value = undefined
  try {
    await action()
    show(undefined)
    status.value = { kind: 'ok', message: done }
    table.value?.refresh()
  } catch (error) {
    status.value = { kind: 'error', message: failureMessage(error, t('cms.errors.failed')) }
  } finally {
    pending.value = false
  }
}

function save() {
  const form = editing.value
  if (!form) return
  const input = { ...form.input }
  return run(
    () => (form.id ? redirects.update(form.id, input) : redirects.create(input)),
    t('cms.redirects.saved'),
  )
}
async function remove() {
  const id = editing.value?.id
  if (id) await run(() => redirects.remove(id), t('cms.redirects.deleted'))
  confirming.value = false
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  imported.value = undefined
  await run(async () => (imported.value = await redirects.importCsv(await file.text())), '')
}
</script>

<template>
  <section>
    <PageHeader :title="t('cms.redirects.title')" :description="t('cms.redirects.description')">
      <template v-if="canEdit" #actions>
        <UButton
          icon="i-lucide-upload"
          color="neutral"
          variant="outline"
          :label="t('cms.redirects.import')"
          :loading="pending"
          @click="fileInput?.click()"
        />
        <input
          ref="fileInput"
          type="file"
          class="sr-only"
          tabindex="-1"
          accept=".csv,text/csv"
          :aria-label="t('cms.redirects.import')"
          @change="importFile"
        />
        <UButton icon="i-lucide-plus" :label="t('cms.redirects.create')" @click="startCreate" />
      </template>
    </PageHeader>
    <CachePurgeNotice :pending="pending" class="mb-4" />

    <p v-if="canEdit" class="mb-4 text-sm text-muted">{{ t('cms.redirects.importHelp') }}</p>
    <p
      v-if="status && status.message && !editing"
      :role="status.kind === 'error' ? 'alert' : 'status'"
      :class="status.kind === 'error' ? 'text-error' : 'text-success'"
      class="mb-4 text-sm"
    >
      {{ status.message }}
    </p>
    <div v-if="imported" role="status" class="mb-4 text-sm">
      <p>
        {{
          t('cms.redirects.imported', {
            created: imported.created,
            skipped: imported.skipped,
            errors: imported.errors.length,
          })
        }}
      </p>
      <ul v-if="imported.errors.length > 0" class="mt-2 list-disc ps-5 text-error">
        <li v-for="error in imported.errors" :key="error.row">
          {{ t('cms.redirects.row', { row: error.row, message: error.message }) }}
        </li>
      </ul>
    </div>

    <DataTable
      ref="table"
      :columns="columns"
      :load="load"
      :caption="t('cms.redirects.caption')"
      :empty-title="t('cms.redirects.empty')"
      searchable
      :on-row-click="startEdit"
    >
      <template #status-cell="{ row }">
        {{ row.original.status }}
        <span v-if="row.original.auto" class="ms-2 text-xs text-muted">
          {{ t('cms.redirects.auto') }}
        </span>
      </template>
    </DataTable>

    <USlideover
      v-model:open="open"
      :dismissible="dismissible"
      :title="editing?.id ? t('cms.redirects.edit') : t('cms.redirects.create')"
      @close:prevent="close"
    >
      <template #body>
        <p
          v-if="status && status.message"
          :role="status.kind === 'error' ? 'alert' : 'status'"
          :class="status.kind === 'error' ? 'text-error' : 'text-success'"
          class="mb-4 text-sm"
        >
          {{ status.message }}
        </p>
        <form v-if="editing" :id="formId" class="space-y-4" @submit.prevent="save">
          <FieldText
            v-model="editing.input.from"
            name="from"
            :label="t('cms.redirects.from')"
            :help="t('cms.redirects.pathHelp')"
            :disabled="pending"
            required
            :maxlength="1024"
          />
          <FieldText
            v-model="editing.input.to"
            name="to"
            :label="t('cms.redirects.to')"
            :disabled="pending"
            required
            :maxlength="1024"
          />
          <FieldSelect
            v-model="editing.input.status"
            name="status"
            :label="t('cms.redirects.status')"
            :items="statuses"
            :disabled="pending"
          />
          <FieldSelect
            v-if="redirects.contentLocales.value.length > 1"
            v-model="editing.input.locale"
            name="locale"
            :label="t('cms.redirects.locale')"
            :items="redirects.contentLocales.value"
            :disabled="pending"
          />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-end gap-2">
          <UButton
            v-if="editing?.id"
            class="me-auto"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :label="t('cms.redirects.delete')"
            :disabled="pending"
            @click="confirming = true"
          />
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('cms.redirects.cancel')"
            :disabled="pending"
            @click="close"
          />
          <UButton
            type="submit"
            :form="formId"
            :label="t('cms.redirects.save')"
            :loading="pending"
          />
        </div>
      </template>
    </USlideover>

    <ConfirmDialog
      v-model:open="confirming"
      :title="t('cms.redirects.deleteTitle')"
      :description="t('cms.redirects.deleteWarning')"
      :confirm-label="t('cms.redirects.delete')"
      :loading="pending"
      danger
      @confirm="remove"
    />
  </section>
</template>
