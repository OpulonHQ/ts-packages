<script setup lang="ts">
/** Picks an admin locale (or the admin default) from the locales the host offers. */
import { useAdmin, useI18n } from '@opulonjs/admin'
import { languageName, UButton } from '@opulonjs/ui'
import { computed } from 'vue'

const props = defineProps<{ label: string; modelValue: string | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [locale: string | null] }>()
const { t } = useI18n()
const { locales } = useAdmin()
const shown = computed(() =>
  props.modelValue !== null && locales.includes(props.modelValue) ? props.modelValue : null,
)
</script>

<template>
  <fieldset>
    <legend class="mb-2 font-medium">{{ label }}</legend>
    <div class="flex flex-wrap gap-2">
      <UButton
        :variant="shown === null ? 'solid' : 'outline'"
        :aria-pressed="shown === null"
        :disabled="disabled"
        :label="t('users.account.defaultLocale')"
        @click="emit('update:modelValue', null)"
      />
      <UButton
        v-for="locale in locales"
        :key="locale"
        :lang="locale"
        :variant="shown === locale ? 'solid' : 'outline'"
        :aria-pressed="shown === locale"
        :disabled="disabled"
        :label="languageName(locale)"
        @click="emit('update:modelValue', locale)"
      />
    </div>
  </fieldset>
</template>
