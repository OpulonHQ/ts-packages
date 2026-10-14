<script setup lang="ts">
/** The signed-in user's own settings: the admin language. */
import { useAdmin, useI18n } from '@opulonjs/admin'
import { UCard } from '@opulonjs/ui'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { ref } from 'vue'
import { useUsersClient } from './client.ts'
import LocalePicker from './LocalePicker.vue'

const { t } = useI18n()
const { me, saveLocale } = useAdmin()
const users = useUsersClient({ detached: true })
const busy = ref(false)
const failed = ref(false)

async function setLocale(locale: string | null) {
  busy.value = true
  failed.value = false
  try {
    await saveLocale(locale, (id) =>
      users((c) => c.setLocale({ params: { id }, payload: { locale } })),
    )
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <PageHeader :title="t('users.account.title')" :description="me?.user.email" />
    <p v-if="failed" role="alert" class="text-error">{{ t('users.errors.failed') }}</p>
    <UCard>
      <LocalePicker
        :label="t('users.account.locale')"
        :model-value="me?.locale ?? null"
        :disabled="busy"
        @update:model-value="setLocale"
      />
    </UCard>
  </section>
</template>
