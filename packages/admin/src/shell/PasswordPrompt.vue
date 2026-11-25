<script setup lang="ts">
import { UButton, UForm, UModal } from '@opulonjs/ui'
import FieldText from '@opulonjs/ui/components/Field/Text'
import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PasswordRequest } from '../state.ts'

const props = defineProps<{ request: PasswordRequest }>()
const { t } = useI18n()
const state = ref({ password: null as string | null })
const error = ref<string>()
const busy = ref(false)
let mounted = true
onUnmounted(() => (mounted = false))

async function submit() {
  busy.value = true
  error.value = undefined
  const outcome = await props.request.submit(state.value.password ?? '')
  if (!mounted || outcome === 'confirmed') return
  error.value = t(`admin.confirmPassword.${outcome}`)
  state.value.password = null
  busy.value = false
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('admin.confirmPassword.title')"
    :description="t('admin.confirmPassword.description')"
    :dismissible="!busy"
    :close="!busy"
    @update:open="(open: boolean) => open || request.cancel()"
  >
    <template #body>
      <UForm :state="state" class="space-y-4" @submit="submit">
        <p v-if="error" role="alert" class="text-error">{{ error }}</p>
        <FieldText
          v-model="state.password"
          name="password"
          type="password"
          :label="t('admin.confirmPassword.password')"
          required
        />
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('admin.confirmPassword.cancel')"
            :disabled="busy"
            @click="request.cancel()"
          />
          <UButton type="submit" :loading="busy" :label="t('admin.confirmPassword.submit')" />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
