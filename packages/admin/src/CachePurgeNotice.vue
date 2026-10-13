<script setup lang="ts">
import { CoreGroup } from '@opulonjs/core/api'
import { UAlert } from '@opulonjs/ui'
import { useI18n } from 'vue-i18n'
import { useApiClient } from './api-client.ts'
import en from './messages/cache-purges/en.ts'
import sk from './messages/cache-purges/sk.ts'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'

const props = defineProps<{ pending?: boolean }>()
const core = useApiClient(CoreGroup)
const { t, locale } = useI18n({ useScope: 'local', messages: { en, sk } })
const load = () => core((client) => client.cachePurges())
const summary = ref<Awaited<ReturnType<typeof load>>['summary']>({
  total: 0,
  failed: 0,
  staleUntil: null,
})
const unavailable = ref(false)

async function refresh() {
  if (props.pending) return
  try {
    summary.value = (await load()).summary
    unavailable.value = false
  } catch {
    unavailable.value = true
  }
}

watch(() => props.pending, refresh, { immediate: true })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(refresh, 30_000)
})
onScopeDispose(() => {
  clearInterval(timer)
})
const staleUntil = computed(() => new Date(summary.value.staleUntil ?? 0))
const message = computed(() =>
  t('admin.cachePurges.stale', {
    time: staleUntil.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }),
  }),
)
const exhausted = computed(() => summary.value.failed > 0)
</script>

<template>
  <UAlert
    v-if="summary.total || unavailable"
    role="status"
    color="neutral"
    variant="outline"
    icon="i-lucide-triangle-alert"
    class="w-full"
    :title="unavailable ? t('admin.cachePurges.unavailable') : message"
    :description="
      unavailable
        ? undefined
        : t(exhausted ? 'admin.cachePurges.failed' : 'admin.cachePurges.queued')
    "
  />
</template>
