<script setup lang="ts">
import { CoreGroup, type AuditPage } from '@opulonjs/core/api'
import { UButton, UCard } from '@opulonjs/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiClient } from '../api-client.ts'
import { useAdmin } from '../state.ts'
import AuditEventDetails from './AuditEventDetails.vue'

const props = defineProps<{ subjectType: string; subjectId: string }>()
const { t } = useI18n()
const { can, me } = useAdmin()
const core = useApiClient(CoreGroup)
const allowed = computed(
  () =>
    can('core.audit.view') &&
    me.value?.modules.includes('core') &&
    props.subjectType !== '' &&
    props.subjectId !== '',
)
const page = ref(1)
const perPage = 10
const events = shallowRef<AuditPage>({ rows: [], total: 0 })
const status = ref<'loading' | 'ready' | 'failed'>('loading')
let latest = 0

async function load() {
  const ticket = ++latest
  if (!allowed.value) {
    events.value = { rows: [], total: 0 }
    return
  }
  status.value = 'loading'
  try {
    const result = await core((client) =>
      client.audit({
        query: {
          subjectType: props.subjectType,
          subjectId: props.subjectId,
          page: page.value,
          perPage,
        },
      }),
    )
    if (ticket === latest) {
      events.value = result
      status.value = 'ready'
    }
  } catch {
    if (ticket === latest) status.value = 'failed'
  }
}

function refresh() {
  page.value = 1
  return load()
}
function movePage(direction: -1 | 1) {
  page.value += direction
  void load()
}
defineExpose({ refresh })
watch([() => props.subjectType, () => props.subjectId, allowed], refresh, { immediate: true })
</script>

<template>
  <section v-if="allowed" :aria-label="t('admin.audit.timeline')">
    <UCard>
      <template #header
        ><h2 class="font-semibold">{{ t('admin.audit.timeline') }}</h2></template
      >
      <p v-if="status === 'loading'" role="status">{{ t('admin.loading') }}</p>
      <div v-else-if="status === 'failed'" class="space-y-2">
        <p role="alert" class="text-error">{{ t('admin.audit.failed') }}</p>
        <UButton :label="t('admin.audit.retry')" @click="load" />
      </div>
      <template v-else>
        <p v-if="!events.rows.length">{{ t('admin.audit.empty') }}</p>
        <ol class="divide-y divide-default">
          <li v-for="event in events.rows" :key="event.id" class="py-4 first:pt-0 last:pb-0">
            <AuditEventDetails :event="event" />
          </li>
        </ol>
        <div v-if="events.total > perPage" class="mt-4 flex flex-wrap items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="page === 1"
            :label="t('admin.audit.previous')"
            @click="movePage(-1)"
          />
          <span class="text-sm text-muted">{{
            t('admin.audit.page', { page, pages: Math.ceil(events.total / perPage) })
          }}</span>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="page * perPage >= events.total"
            :label="t('admin.audit.next')"
            @click="movePage(1)"
          />
        </div>
      </template>
    </UCard>
  </section>
</template>
