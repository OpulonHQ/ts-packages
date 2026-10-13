<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { UButton, UForm, ULink } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { ref } from 'vue'
import AuthCard from './AuthCard.vue'
import { useAuthClient } from './client.ts'

const { t } = useI18n()
const call = useAuthClient()
const state = ref({ email: null as string | null })
const error = ref<string>()
const notice = ref<string>()
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = undefined
  const result = await call((client) =>
    client.requestPasswordReset({ payload: { email: state.value.email ?? '' } }),
  )
  // The same answer whether or not the address belongs to a user.
  if (result.ok) notice.value = t('users.forgot.sent')
  else
    error.value = t(
      result.tag === 'TooManyRequests' ? 'users.errors.tooMany' : 'users.errors.failed',
    )
  busy.value = false
}
</script>

<template>
  <AuthCard
    :title="t('users.forgot.title')"
    :description="t('users.forgot.description')"
    :error="error"
    :notice="notice"
  >
    <UForm v-if="!notice" :state="state" class="space-y-4" @submit="submit">
      <FieldText
        v-model="state.email"
        name="email"
        type="email"
        :label="t('users.fields.email')"
        required
      />
      <UButton type="submit" block :loading="busy" :label="t('users.forgot.submit')" />
    </UForm>
    <ULink :to="{ name: 'users.signIn' }" class="block text-center text-sm">
      {{ t('users.forgot.back') }}
    </ULink>
  </AuthCard>
</template>
