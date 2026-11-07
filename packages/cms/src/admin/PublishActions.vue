<script setup lang="ts">
/**
 * Status and the publishing actions of a page, an item, the site settings or a menu: Publish
 * (saves what is on screen first), Unpublish (asks first: it takes content off the website) and
 * Delete. Saving a draft is the unsaved-changes bar's job.
 */
import { useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import ConfirmDialog from '@opulonjs/ui/components/ConfirmDialog'
import StatusBadge from '@opulonjs/ui/components/StatusBadge'
import { ref } from 'vue'
import type { PageStatus } from '../api.ts'

defineProps<{
  status: PageStatus
  published: boolean
  pending: boolean
  canEdit: boolean
  canPublish: boolean
  /** Offers delete (items, pages other than system pages). */
  deletable?: boolean
}>()
const emit = defineEmits<{ publish: []; unpublish: []; delete: [] }>()

const { t } = useI18n()
const unpublishing = ref(false)
const unpublish = () => {
  unpublishing.value = false
  emit('unpublish')
}
</script>

<template>
  <StatusBadge
    :status="status"
    :label="t(`cms.status.${status}`)"
    :color="status === 'changed' ? 'warning' : undefined"
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
    @click="unpublishing = true"
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
  <ConfirmDialog
    v-model:open="unpublishing"
    :title="t('cms.unpublish.title')"
    :description="t('cms.unpublish.description')"
    :confirm-label="t('cms.page.unpublish')"
    danger
    @confirm="unpublish"
  />
</template>
