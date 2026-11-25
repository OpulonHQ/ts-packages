<script setup lang="ts">
import { useAdmin, useI18n, useRoute, useRouter } from '@opulonjs/admin'
import { UButton, UForm, ULink } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { ref, useTemplateRef } from 'vue'
import AuthCard from './AuthCard.vue'
import { safeRedirect, useAuthClient } from './client.ts'
import TurnstileField from './TurnstileField.vue'

const props = defineProps<{ turnstileSiteKey?: string | undefined }>()
const { t } = useI18n()
const { refresh } = useAdmin()
const route = useRoute()
const router = useRouter()
const call = useAuthClient()
const state = ref({ email: null as string | null, password: null as string | null })
const error = ref<string>()
const busy = ref(false)
const turnstileToken = ref<string>()
const turnstile = useTemplateRef('turnstile')

const errors: Record<string, string> = {
  Unauthorized: 'users.signIn.invalid',
  TooManyRequests: 'users.errors.tooMany',
  TurnstileFailed: props.turnstileSiteKey
    ? 'users.errors.turnstile'
    : 'users.errors.turnstileSetup',
  TurnstileNotConfigured: 'users.errors.turnstileSetup',
}

async function submit() {
  busy.value = true
  error.value = undefined
  const result = await call((client) =>
    client.signIn({
      payload: {
        email: state.value.email ?? '',
        password: state.value.password ?? '',
        ...(turnstileToken.value ? { turnstileToken: turnstileToken.value } : {}),
      },
    }),
  )
  if (result.ok) {
    // The session cookie is set: the shell reads /me as the signed-in user.
    await refresh()
    await router.replace(safeRedirect(route.query.redirect))
  } else {
    error.value = t(errors[result.tag] ?? 'users.errors.failed')
    state.value.password = null
    turnstile.value?.reset()
  }
  busy.value = false
}
</script>

<template>
  <AuthCard :title="t('users.signIn.title')" :error="error">
    <UForm :state="state" class="space-y-4" @submit="submit">
      <FieldText
        v-model="state.email"
        name="email"
        type="email"
        :label="t('users.fields.email')"
        required
      />
      <FieldText
        v-model="state.password"
        name="password"
        type="password"
        :label="t('users.fields.password')"
        required
      />
      <TurnstileField
        v-if="turnstileSiteKey"
        ref="turnstile"
        v-model="turnstileToken"
        :site-key="turnstileSiteKey"
        action="sign-in"
      />
      <UButton
        type="submit"
        block
        :loading="busy"
        :disabled="!!turnstileSiteKey && !turnstileToken"
        :label="t('users.signIn.submit')"
      />
    </UForm>
    <ULink :to="{ name: 'users.forgotPassword' }" class="block text-center text-sm">
      {{ t('users.signIn.forgot') }}
    </ULink>
  </AuthCard>
</template>
