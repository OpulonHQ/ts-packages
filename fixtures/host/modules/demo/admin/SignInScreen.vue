<script setup lang="ts">
import { useAdmin, useI18n } from '@opulonjs/admin'
import { UButton, UCard, UForm } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { signInWithToken } from './stub-auth.ts'

const { t } = useI18n()
const { brand } = useAdmin()
const route = useRoute()
const state = ref({ token: null as string | null })

function submit() {
  signInWithToken(state.value.token ?? '')
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  // A full load, so the shell reads /me again as the signed-in user.
  location.assign(`/admin${redirect.startsWith('/') ? redirect : '/'}`)
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold text-highlighted">{{ t('demo.signIn.title') }}</h1>
        <p class="text-sm text-muted">{{ brand.name }}</p>
      </template>
      <UForm :state="state" class="space-y-4" @submit="submit">
        <FieldText
          v-model="state.token"
          name="token"
          type="password"
          :label="t('demo.signIn.token')"
          required
        />
        <UButton type="submit" block :label="t('demo.signIn.submit')" />
      </UForm>
    </UCard>
  </div>
</template>
