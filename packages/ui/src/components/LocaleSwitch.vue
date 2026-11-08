<script setup lang="ts">
/**
 * One content language for a whole editor: the language names in a row, the chosen one
 * underlined as in `LocaleTabs`. Native radios: Tab reaches the chosen language, the arrow keys
 * choose another, and the group is named "Content language" (or `label`). Nothing renders for
 * fewer than two locales, as there is nothing to choose.
 *
 * <LocaleSwitch v-model="contentLocale" :locales="['en', 'it']" />
 */
import { useLocale } from '@nuxt/ui/composables'
import { useId } from 'vue'
import { languageName } from '../format.ts'
import { useKitText } from '../text.ts'

defineProps<{
  locales: ReadonlyArray<string>
  /** Names by locale code; default: the language's name in the admin locale. */
  labels?: Readonly<Record<string, string>>
  /** The group's name; default "Content language". */
  label?: string
}>()
const model = defineModel<string>()

const { code } = useLocale()
const text = useKitText()
const id = useId()
</script>

<template>
  <div v-if="locales.length > 1" class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <span :id="`${id}-label`" class="text-sm font-medium text-highlighted">
      {{ label ?? text.contentLanguage }}
    </span>
    <div role="radiogroup" :aria-labelledby="`${id}-label`" class="flex border-b border-default">
      <label
        v-for="locale in locales"
        :key="locale"
        class="-mb-px cursor-pointer rounded-t-md border-b border-transparent px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-default has-[:checked]:border-primary has-[:checked]:text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
      >
        <input v-model="model" type="radio" :name="id" :value="locale" class="sr-only" />
        {{ labels?.[locale] ?? languageName(locale, code) }}
      </label>
    </div>
  </div>
</template>
