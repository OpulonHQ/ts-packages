<script setup lang="ts">
import { useAdmin, useApiClient, useI18n } from '@opulonjs/admin'
import { UAlert } from '@opulonjs/ui'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { cachePurgeViewPermissions, CmsGroup } from '../api.ts'

const props = defineProps<{ pending?: boolean }>()
const admin = useAdmin()
const cms = useApiClient(CmsGroup)
const { t, locale } = useI18n()
const load = () => cms((client) => client.cachePurges())
const summary = ref<Awaited<ReturnType<typeof load>>['summary']>({
  total: 0,
  failed: 0,
  staleUntil: null,
})
const unavailable = ref(false)
const canRead = computed(() => cachePurgeViewPermissions.some(admin.can))

async function refresh() {
  if (!canRead.value || props.pending) return
  try {
    summary.value = (await load()).summary
    unavailable.value = false
  } catch {
    unavailable.value = true
  }
}

watch([canRead, () => props.pending], refresh, { immediate: true })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(refresh, 30_000)
})
onScopeDispose(() => {
  clearInterval(timer)
})
const staleUntil = computed(() => new Date(summary.value.staleUntil ?? 0))
const message = computed(() =>
  t('cms.cachePurges.stale', {
    time: staleUntil.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }),
  }),
)
const exhausted = computed(() => summary.value.failed > 0)
</script>

<template>
  <UAlert
    v-if="canRead && (summary.total || unavailable)"
    role="status"
    color="warning"
    icon="i-lucide-triangle-alert"
    class="w-full"
    :title="unavailable ? t('cms.cachePurges.unavailable') : message"
    :description="
      unavailable ? undefined : t(exhausted ? 'cms.cachePurges.failed' : 'cms.cachePurges.queued')
    "
  />
</template>
