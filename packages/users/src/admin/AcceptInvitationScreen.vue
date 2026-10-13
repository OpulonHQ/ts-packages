<script setup lang="ts">
import { useAdmin, useI18n, useRoute, useRouter } from '@opulonjs/admin'
import { UButton, UForm } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { onMounted, ref } from 'vue'
import AuthCard from './AuthCard.vue'
import { takeToken, useAuthClient } from './client.ts'

const { t } = useI18n()
const { refresh } = useAdmin()
const router = useRouter()
const call = useAuthClient()
const token = takeToken(useRoute().hash)
const email = ref<string>()
const state = ref({
  name: null as string | null,
  password: null as string | null,
  confirm: null as string | null,
})
const error = ref<string>()
const busy = ref(false)

const errors: Record<string, string> = {
  InvalidToken: 'users.invitation.invalid',
  Conflict: 'users.invitation.taken',
  TooManyRequests: 'users.errors.tooMany',
}
const fail = (tag: string) => (error.value = t(errors[tag] ?? 'users.errors.failed'))

onMounted(async () => {
  if (!token) return fail('InvalidToken')
  const result = await call((client) => client.invitation({ payload: { token } }))
  if (result.ok) email.value = result.value.email
  else fail(result.tag)
})

async function submit() {
  const password = state.value.password ?? ''
  if (password.length < 8) return void (error.value = t('users.errors.short'))
  if (password !== state.value.confirm) return void (error.value = t('users.errors.mismatch'))
  if (!token || !email.value) return
  busy.value = true
  error.value = undefined
  const accepted = await call((client) =>
    client.acceptInvitation({
      payload: { token, name: (state.value.name ?? '').trim(), password },
    }),
  )
  const signedIn = accepted.ok
    ? await call((client) => client.signIn({ payload: { email: email.value!, password } }))
    : accepted
  if (signedIn.ok) {
    await refresh()
    await router.replace('/')
  } else fail(signedIn.tag)
  busy.value = false
}
</script>

<template>
  <AuthCard
    :title="t('users.invitation.title')"
    :description="email ? t('users.invitation.description', { email }) : undefined"
    :error="error"
  >
    <UForm v-if="email" :state="state" class="space-y-4" @submit="submit">
      <FieldText
        v-model="state.name"
        name="name"
        :label="t('users.fields.name')"
        :maxlength="200"
        required
      />
      <FieldText
        v-model="state.password"
        name="password"
        type="password"
        :label="t('users.fields.password')"
        required
      />
      <FieldText
        v-model="state.confirm"
        name="confirm"
        type="password"
        :label="t('users.fields.confirmPassword')"
        required
      />
      <UButton type="submit" block :loading="busy" :label="t('users.invitation.submit')" />
    </UForm>
  </AuthCard>
</template>
