<script setup lang="ts">
import { useAdmin, useI18n } from '@opulonjs/admin'
import { UButton, UCard, UForm } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import PageHeader from '@opulonjs/ui/components/PageHeader'
import { ref } from 'vue'
import { failureKey, useUsersClient } from './client.ts'
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

const api = useUsersClient()
const blank = () => ({
  current: null as string | null,
  password: null as string | null,
  confirm: null as string | null,
})
const form = ref(blank())
const notice = ref<{ error: boolean; text: string }>()
const changing = ref(false)

async function changePassword() {
  const newPassword = form.value.password ?? ''
  const fail = (key: string) => void (notice.value = { error: true, text: t(key) })
  if (newPassword.length < 8) return fail('users.errors.short')
  if (newPassword !== form.value.confirm) return fail('users.errors.mismatch')
  changing.value = true
  notice.value = undefined
  const payload = { currentPassword: form.value.current ?? '', newPassword }
  try {
    await api((c) => c.changePassword({ payload }))
    form.value = blank()
    notice.value = { error: false, text: t('users.account.passwordChanged') }
  } catch (error) {
    fail(
      failureKey(error, {
        WrongPassword: 'users.account.wrongPassword',
        TooManyRequests: 'users.errors.tooMany',
      }),
    )
  } finally {
    changing.value = false
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
    <UCard>
      <UForm :state="form" class="space-y-4" @submit="changePassword">
        <h2 class="font-medium">{{ t('users.account.password') }}</h2>
        <p
          v-if="notice"
          :role="notice.error ? 'alert' : 'status'"
          :class="notice.error ? 'text-error' : 'text-success'"
          class="text-sm"
        >
          {{ notice.text }}
        </p>
        <FieldText
          v-model="form.current"
          name="current"
          type="password"
          autocomplete="current-password"
          :label="t('users.account.currentPassword')"
          :disabled="changing"
          required
        />
        <FieldText
          v-model="form.password"
          name="password"
          type="password"
          autocomplete="new-password"
          :label="t('users.fields.newPassword')"
          :disabled="changing"
          required
        />
        <FieldText
          v-model="form.confirm"
          name="confirm"
          type="password"
          autocomplete="new-password"
          :label="t('users.fields.confirmPassword')"
          :disabled="changing"
          required
        />
        <UButton type="submit" :loading="changing" :label="t('users.account.passwordSubmit')" />
      </UForm>
    </UCard>
  </section>
</template>
