<script setup lang="ts">
/** Status and the draft/publish buttons of an item, the site settings or a menu. */
import { useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import type { PageStatus } from '../api.ts'
import StalePurgeNotice from './StalePurgeNotice.vue'

defineProps<{
  status: PageStatus
  published: boolean
  pending: boolean
  canEdit: boolean
  canPublish: boolean
  /** Offers delete (items). */
  deletable?: boolean
}>()
defineEmits<{ save: []; publish: []; unpublish: []; delete: [] }>()

const { t } = useI18n()
</script>

<template>
  <StalePurgeNotice :pending="pending" />
  <StatusBadge
    :status="status"
    :label="t(`cms.status.${status}`)"
    :color="status === 'changed' ? 'warning' : undefined"
  />
  <UButton
    v-if="canEdit"
    :label="t('cms.page.save')"
    color="neutral"
    variant="outline"
    :loading="pending"
    @click="$emit('save')"
  />
  <UButton
    v-if="canEdit && canPublish"
    :label="t('cms.page.publish')"
    icon="i-lucide-globe"
    :loading="pending"
    @click="$emit('publish')"
  />
  <UButton
    v-if="canPublish && published"
    :label="t('cms.page.unpublish')"
    color="neutral"
    variant="ghost"
    :disabled="pending"
    @click="$emit('unpublish')"
  />
  <UButton
    v-if="canEdit && deletable"
    :label="t('cms.page.delete')"
    color="error"
    variant="ghost"
    icon="i-lucide-trash-2"
    :disabled="pending"
    @click="$emit('delete')"
  />
</template>
