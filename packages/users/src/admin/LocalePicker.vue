<script setup lang="ts">
/** Picks an admin locale (or the admin default) from the locales the admin has messages for. */
import { useI18n } from '@opulonjs/admin'
import { UButton } from '@opulonjs/ui'
import { localeName } from './client.ts'

defineProps<{ label: string; modelValue: string | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [locale: string | null] }>()
const { t, availableLocales } = useI18n()
</script>

<template>
  <fieldset>
    <legend class="mb-2 font-medium">{{ label }}</legend>
    <div class="flex flex-wrap gap-2">
      <UButton
        :variant="modelValue === null ? 'solid' : 'outline'"
        :aria-pressed="modelValue === null"
        :disabled="disabled"
        :label="t('users.account.defaultLocale')"
        @click="emit('update:modelValue', null)"
      />
      <UButton
        v-for="locale in availableLocales"
        :key="locale"
        :lang="locale"
        :variant="modelValue === locale ? 'solid' : 'outline'"
        :aria-pressed="modelValue === locale"
        :disabled="disabled"
        :label="localeName(locale)"
        @click="emit('update:modelValue', locale)"
      />
    </div>
  </fieldset>
</template>
