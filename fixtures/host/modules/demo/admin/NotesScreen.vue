<script setup lang="ts">
import { useApiClient, useI18n } from '@opulonjs/admin'
import { ref } from 'vue'
import { DemoGroup } from '../api.ts'

const { t } = useI18n()
const demo = useApiClient(DemoGroup)
const notes = ref<ReadonlyArray<{ id: number; body: string }>>()
const failed = ref(false)

demo((client) => client.notes()).then(
  (rows) => (notes.value = rows),
  () => (failed.value = true),
)
</script>

<template>
  <section>
    <h1>{{ t('demo.notes.title') }}</h1>
    <p v-if="failed" role="alert">{{ t('demo.notes.failed') }}</p>
    <p v-else-if="notes && notes.length === 0">{{ t('demo.notes.empty') }}</p>
    <ul v-else-if="notes">
      <li v-for="note in notes" :key="note.id">{{ note.body }}</li>
    </ul>
  </section>
</template>
