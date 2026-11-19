<script setup lang="ts">
import { useI18n } from '@opulonjs/admin'
import { languageName, UBadge } from '@opulonjs/ui'

defineProps<{ locales: ReadonlyArray<string> }>()

const { locale } = useI18n()
</script>

<template>
  <span class="flex flex-wrap gap-1">
    <UBadge
      v-for="code in locales"
      :key="code"
      :data-locale="code"
      :title="languageName(code, locale)"
      color="neutral"
      variant="subtle"
      size="sm"
    >
      {{ code.toUpperCase() }}
    </UBadge>
  </span>
</template>
