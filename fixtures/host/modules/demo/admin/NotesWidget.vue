<script setup lang="ts">
import { useApiClient, useI18n } from '@opulonjs/admin'
import StatCard from '@opulonjs/ui/components/StatCard'
import { ref } from 'vue'
import { DemoGroup } from '../api.ts'

const { t } = useI18n()
const demo = useApiClient(DemoGroup)
const count = ref<number>()

demo((client) => client.notes()).then(
  (rows) => (count.value = rows.length),
  () => (count.value = undefined),
)
</script>

<template>
  <StatCard
    :label="t('demo.notes.count')"
    :value="count"
    :loading="count === undefined"
    icon="i-lucide-notebook"
    :to="{ name: 'demo.notes' }"
  />
</template>
