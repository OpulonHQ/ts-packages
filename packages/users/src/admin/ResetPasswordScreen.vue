<script setup lang="ts">
import { useI18n, useRoute } from '@opulonjs/admin'
import { UButton, UForm, ULink } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { ref } from 'vue'
import AuthCard from './AuthCard.vue'
import { takeToken, useAuthClient } from './client.ts'

const { t } = useI18n()
const call = useAuthClient()
const token = takeToken(useRoute().hash)
const state = ref({ password: null as string | null, confirm: null as string | null })
const error = ref<string | undefined>(token ? undefined : t('users.reset.invalid'))
const done = ref(false)
const busy = ref(false)

const errors: Record<string, string> = {
  InvalidToken: 'users.reset.invalid',
  TooManyRequests: 'users.errors.tooMany',
}

async function submit() {
  const password = state.value.password ?? ''
  if (password.length < 8) return void (error.value = t('users.errors.short'))
  if (password !== state.value.confirm) return void (error.value = t('users.errors.mismatch'))
  busy.value = true
  error.value = undefined
  const result = await call((client) =>
    client.resetPassword({ payload: { token: token ?? '', password } }),
  )
  if (result.ok) done.value = true
  else error.value = t(errors[result.tag] ?? 'users.errors.failed')
  busy.value = false
}
</script>

<template>
  <AuthCard
    :title="t('users.reset.title')"
    :error="error"
    :notice="done ? t('users.reset.done') : undefined"
  >
    <UForm v-if="token && !done" :state="state" class="space-y-4" @submit="submit">
      <FieldText
        v-model="state.password"
        name="password"
        type="password"
        :label="t('users.fields.newPassword')"
        required
      />
      <FieldText
        v-model="state.confirm"
        name="confirm"
        type="password"
        :label="t('users.fields.confirmPassword')"
        required
      />
      <UButton type="submit" block :loading="busy" :label="t('users.reset.submit')" />
    </UForm>
    <ULink
      :to="{ name: done ? 'users.signIn' : 'users.forgotPassword' }"
      class="block text-center text-sm"
    >
      {{ done ? t('users.signIn.title') : t('users.forgot.title') }}
    </ULink>
  </AuthCard>
</template>
