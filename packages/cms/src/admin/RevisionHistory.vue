<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { UButton, UCard, type TableQuery } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import DataTable from '@opulonjs/ui/components/DataTable'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { revisionPageSize, type RevisionSummary } from '../api.ts'
import RevisionView from './RevisionView.vue'
import ActionStatus from './ActionStatus.vue'
import { type ActionResult, failureMessage, failureStatus } from './use-cms.ts'
import { useRevisions, type RevisionSnapshot, type RevisionTarget } from './use-revisions.ts'

const props = defineProps<{
  kind: RevisionTarget['kind']
  documentRef: string
  collection?: string
  publishedRevisionId: string | null
  version: number
  canRestore: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ restored: []; reload: []; busy: [value: boolean] }>()
const { t, locale } = useI18n()
const api = useRevisions()
const identity = computed(() => `${props.kind}:${props.documentRef}:${props.publishedRevisionId}`)
const target = (): RevisionTarget => ({ kind: props.kind, ref: props.documentRef })
const columns = computed(() => [
  {
    key: 'createdAt',
    label: t('cms.revisions.date'),
    format: (v: unknown) => new Date(String(v)).toLocaleString(locale.value),
  },
  { key: 'author.name', label: t('cms.revisions.author') },
])
const state = shallowRef<
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'view'; snapshot: RevisionSnapshot }
  | { kind: 'error'; message: string }
>({ kind: 'idle' })
const confirming = ref(false)
const restoring = ref(false)
const status = ref<ActionResult>()
let ticket = 0
watch(identity, () => {
  ticket++
  state.value = { kind: 'idle' }
  confirming.value = false
  status.value = undefined
})
watch(
  () => props.version,
  () => {
    if (status.value?.kind === 'conflict') status.value = undefined
  },
)
onBeforeUnmount(() => {
  ticket++
  emit('busy', false)
})
const load = (query: TableQuery) => api.list(target(), query.page)
async function view(row: RevisionSummary) {
  const request = ++ticket
  const document = target()
  confirming.value = false
  status.value = undefined
  state.value = { kind: 'loading' }
  try {
    const snapshot = await api.get(document, row.id)
    if (request === ticket) state.value = { kind: 'view', snapshot }
  } catch (error) {
    if (request === ticket)
      state.value = { kind: 'error', message: failureMessage(error, t('cms.errors.failed')) }
  }
}
async function restore() {
  if (state.value.kind !== 'view' || restoring.value || props.disabled || !props.canRestore) return
  const request = ++ticket
  const document = target()
  const revisionId = state.value.snapshot.revision.id
  restoring.value = true
  emit('busy', true)
  status.value = undefined
  try {
    await api.restore(document, revisionId, props.version)
    if (request !== ticket) return
    confirming.value = false
    status.value = { kind: 'ok', message: t('cms.revisions.restored') }
    emit('restored')
  } catch (error) {
    if (request === ticket) {
      confirming.value = false
      status.value = failureStatus(error, t('cms.errors.failed'))
    }
  } finally {
    restoring.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <UCard class="mt-6">
    <template #header
      ><h2 class="font-semibold text-highlighted">{{ t('cms.revisions.title') }}</h2></template
    >
    <p class="mb-4 text-sm text-muted">{{ t('cms.revisions.description') }}</p>
    <DataTable
      :key="identity"
      :columns="columns"
      :load="load"
      :per-page="revisionPageSize"
      :caption="t('cms.revisions.title')"
      :empty-title="t('cms.revisions.empty')"
    >
      <template #actions="{ row }"
        ><UButton
          :label="t('cms.revisions.view')"
          color="neutral"
          variant="ghost"
          :disabled="restoring"
          @click="view(row)"
      /></template>
    </DataTable>
    <p v-if="state.kind === 'loading'" role="status" class="mt-4 text-sm">
      {{ t('cms.revisions.loading') }}
    </p>
    <p v-else-if="state.kind === 'error'" role="alert" class="mt-4 text-sm text-error">
      {{ state.message }}
    </p>
    <div v-else-if="state.kind === 'view'" class="mt-6 space-y-4 border-t border-default pt-4">
      <h3 class="font-medium">
        {{ new Date(state.snapshot.revision.createdAt).toLocaleString(locale) }} ·
        {{ state.snapshot.revision.author.name }}
      </h3>
      <RevisionView
        :snapshot="state.snapshot"
        :document-ref="documentRef"
        :collection="collection"
      />
      <UButton
        v-if="canRestore"
        :label="t('cms.revisions.restore')"
        icon="i-lucide-history"
        :disabled="disabled || restoring"
        @click="confirming = true"
      />
    </div>
    <ActionStatus :status="status" class="mt-4" @reload="emit('reload')" />
    <ConfirmDialog
      v-model:open="confirming"
      :title="t('cms.revisions.restore')"
      :description="t('cms.revisions.warning')"
      :confirm-label="t('cms.revisions.restore')"
      :loading="restoring"
      @confirm="restore"
    />
  </UCard>
</template>
