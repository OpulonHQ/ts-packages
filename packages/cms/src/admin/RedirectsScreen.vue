<script setup lang="ts">
/** Content > Redirects: list, create, edit, delete and CSV import of exact-path redirects. */
import { useI18n } from '@opulonjs/admin'
import { queryRows, type TableQuery, UButton, UCard } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import DataTable from '@opulonjs/ui/components/DataTable'
import FieldSelect from '@opulonjs/ui/components/Field/Select'
import FieldText from '@opulonjs/ui/components/Field/Text'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { computed, ref } from 'vue'
import type { Redirect, RedirectImportResult, RedirectInput } from '../api.ts'
import { failureMessage, useRedirects } from './use-cms.ts'

const { t } = useI18n()
const redirects = useRedirects()
const canEdit = computed(() => redirects.can('cms.redirects.edit'))
const table = ref<{ refresh: () => void }>()
const fileInput = ref<HTMLInputElement>()
const pending = ref(false)
const status = ref<{ kind: 'ok' | 'error'; message: string }>()
const imported = ref<RedirectImportResult>()
const confirming = ref(false)
/** The form: a new redirect (no id) or the one being edited. */
const editing = ref<{ id?: string; input: RedirectInput }>()

const load = async (query: TableQuery) =>
  queryRows([...(await redirects.list()).rows], ['from', 'to'], query)
const columns = computed(() => [
  { key: 'from', label: t('cms.redirects.from') },
  { key: 'to', label: t('cms.redirects.to') },
  { key: 'status', label: t('cms.redirects.status') },
  ...(redirects.contentLocales.value.length > 1
    ? [{ key: 'locale', label: t('cms.redirects.locale') }]
    : []),
])
const statuses = computed(() => [
  { label: t('cms.redirects.permanent'), value: 301 },
  { label: t('cms.redirects.temporary'), value: 302 },
])

function startCreate() {
  status.value = undefined
  const locale = redirects.contentLocales.value[0] ?? ''
  editing.value = { input: { locale, from: '', to: '', status: 301 } }
}
function startEdit(redirect: Redirect) {
  if (!canEdit.value) return
  status.value = undefined
  const { id, locale, from, to, status: code } = redirect
  editing.value = { id, input: { locale, from, to, status: code } }
}

async function run(action: () => Promise<unknown>, done: string) {
  pending.value = true
  status.value = undefined
  try {
    await action()
    status.value = { kind: 'ok', message: done }
    editing.value = undefined
    table.value?.refresh()
  } catch (error) {
    status.value = { kind: 'error', message: failureMessage(error, t('cms.errors.failed')) }
  } finally {
    pending.value = false
  }
}

const save = () => {
  const form = editing.value!
  return run(
    () => (form.id ? redirects.update(form.id, form.input) : redirects.create(form.input)),
    t('cms.redirects.saved'),
  )
}
async function remove() {
  confirming.value = false
  await run(() => redirects.remove(editing.value!.id!), t('cms.redirects.deleted'))
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

    <p v-if="canEdit" class="mb-4 text-sm text-muted">{{ t('cms.redirects.importHelp') }}</p>
    <p
      v-if="status && status.message"
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

    <UCard v-if="editing" class="mb-6">
      <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="save">
        <h2 class="font-semibold sm:col-span-2">
          {{ editing.id ? t('cms.redirects.edit') : t('cms.redirects.create') }}
        </h2>
        <FieldText
          v-model="editing.input.from"
          name="from"
          :label="t('cms.redirects.from')"
          :help="t('cms.redirects.pathHelp')"
          required
          :maxlength="1024"
        />
        <FieldText
          v-model="editing.input.to"
          name="to"
          :label="t('cms.redirects.to')"
          required
          :maxlength="1024"
        />
        <FieldSelect
          v-model="editing.input.status"
          name="status"
          :label="t('cms.redirects.status')"
          :items="statuses"
        />
        <FieldSelect
          v-if="redirects.contentLocales.value.length > 1"
          v-model="editing.input.locale"
          name="locale"
          :label="t('cms.redirects.locale')"
          :items="redirects.contentLocales.value"
        />
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="t('cms.redirects.save')" :loading="pending" />
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('cms.redirects.cancel')"
            :disabled="pending"
            @click="editing = undefined"
          />
          <UButton
            v-if="editing.id"
            class="ms-auto"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :label="t('cms.redirects.delete')"
            :disabled="pending"
            @click="confirming = true"
          />
        </div>
      </form>
    </UCard>

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

    <ConfirmDialog
      v-model:open="confirming"
      :title="t('cms.redirects.deleteTitle')"
      :confirm-label="t('cms.redirects.delete')"
      :loading="pending"
      danger
      @confirm="remove"
    />
  </section>
</template>
