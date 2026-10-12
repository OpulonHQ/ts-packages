<script setup lang="ts">
/**
 * One tab per content locale for localized fields, with a slot per locale code. Every tab
 * stays mounted so `UForm` still validates fields in hidden tabs.
 *
 * <LocaleTabs :locales="['en', 'it']">
 *   <template #en><FieldText v-model="state.title.en" name="title.en" :label="..." /></template>
 *   <template #it><FieldText v-model="state.title.it" name="title.it" :label="..." /></template>
 * </LocaleTabs>
 */
import type { TabsItem } from '@nuxt/ui'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import { useLocale } from '@nuxt/ui/composables'
import { computed } from 'vue'

const props = defineProps<{
  locales: ReadonlyArray<string>
  /** Tab labels by locale code; default: the language's name in the admin locale. */
  labels?: Readonly<Record<string, string>>
}>()

const { code } = useLocale()
const items = computed<TabsItem[]>(() => {
  const names = new Intl.DisplayNames([code.value], { type: 'language' })
  return props.locales.map((locale) => ({
    label: props.labels?.[locale] ?? names.of(locale) ?? locale,
    value: locale,
    slot: locale,
  }))
})
</script>

<template>
  <UTabs
    :items="items"
    :default-value="locales[0]"
    :unmount-on-hide="false"
    variant="link"
    size="sm"
    class="w-full gap-0"
  >
    <template v-for="locale in locales" :key="locale" #[locale]>
      <div class="space-y-4 pt-4">
        <slot :name="locale" />
      </div>
    </template>
  </UTabs>
</template>
