<script setup lang="ts">
/**
 * Bare rich text editor (toolbar + content, no form field), shared by cms and emails. Prefer
 * `Field/RichText` in forms. The model is HTML; an empty editor is `null`. The format is
 * restricted to the toolbar's marks and nodes (no images, code blocks or mentions); the
 * server still sanitizes what it stores.
 */
import type { EditorSlots, EditorToolbarItem } from '@nuxt/ui'
import UButton from '@nuxt/ui/components/Button.vue'
import UEditor from '@nuxt/ui/components/Editor.vue'
import UEditorToolbar from '@nuxt/ui/components/EditorToolbar.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { defaultRichTextToolbar, type RichTextButton } from '../fields.ts'
import { useKitText } from '../text.ts'

type Editor = Parameters<NonNullable<EditorSlots['default']>>[0]['editor']

const model = defineModel<string | null>()
const props = withDefaults(
  defineProps<{ toolbar?: ReadonlyArray<RichTextButton> | undefined; disabled?: boolean }>(),
  { toolbar: () => defaultRichTextToolbar, disabled: false },
)
const text = useKitText()

const editorRef = useTemplateRef<{ editor: Editor | undefined }>('editor')
watch([() => props.disabled, () => editorRef.value?.editor], ([disabled, editor]) => {
  if (!editor) return
  editor.setEditable(!disabled)
  editor.view.dom.setAttribute('aria-disabled', String(disabled))
})
defineExpose({
  /** Inserts HTML or text at the cursor, e.g. a `{{placeholder}}` token. */
  insert: (content: string) => {
    editorRef.value?.editor?.chain().focus().insertContent(content).run()
  },
})

const html = computed({
  get: () => model.value ?? '',
  set: (value: string) => (model.value = value === '' || value === '<p></p>' ? null : value),
})

const toItem = (button: RichTextButton): EditorToolbarItem => {
  switch (button) {
    case 'bold':
      return { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold' }
    case 'italic':
      return { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic' }
    case 'underline':
      return { kind: 'mark', mark: 'underline', icon: 'i-lucide-underline' }
    case 'strike':
      return { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough' }
    case 'h2':
      return { kind: 'heading', level: 2, icon: 'i-lucide-heading-2' }
    case 'h3':
      return { kind: 'heading', level: 3, icon: 'i-lucide-heading-3' }
    case 'bulletList':
      return { kind: 'bulletList', icon: 'i-lucide-list' }
    case 'orderedList':
      return { kind: 'orderedList', icon: 'i-lucide-list-ordered' }
    case 'blockquote':
      return { kind: 'blockquote', icon: 'i-lucide-text-quote' }
    case 'undo':
      return { kind: 'undo', icon: 'i-lucide-undo-2' }
    case 'redo':
      return { kind: 'redo', icon: 'i-lucide-redo-2' }
    case 'link':
      return { slot: 'link', icon: 'i-lucide-link' }
  }
}
const items = computed(() =>
  props.toolbar.map((button) => ({ ...toItem(button), 'aria-label': text.value.tools[button] })),
)

const linkOpen = ref(false)
const linkUrl = ref('')
function openLink(editor: Editor) {
  linkUrl.value = String(editor.getAttributes('link').href ?? '')
}
function applyLink(editor: Editor) {
  const href = linkUrl.value.trim()
  const chain = editor.chain().focus().extendMarkRange('link')
  ;(href === '' ? chain.unsetLink() : chain.setLink({ href })).run()
  linkOpen.value = false
}
function removeLink(editor: Editor) {
  editor.chain().focus().extendMarkRange('link').unsetLink().run()
  linkOpen.value = false
}
</script>

<template>
  <UEditor
    ref="editor"
    v-slot="{ editor }"
    v-model="html"
    content-type="html"
    :editable="!disabled"
    :starter-kit="{ heading: { levels: [2, 3] }, codeBlock: false }"
    :image="false"
    :mention="false"
    class="w-full rounded-md bg-default ring ring-inset ring-accented focus-within:ring-2 focus-within:ring-primary"
    :class="disabled ? 'cursor-not-allowed opacity-75' : ''"
    :ui="{ content: 'min-h-24 px-3 py-2' }"
  >
    <UEditorToolbar :editor="editor" :items="items" class="border-b border-default px-1.5 py-1">
      <template #link>
        <UPopover v-model:open="linkOpen">
          <UButton
            size="sm"
            color="neutral"
            :variant="editor.isActive('link') ? 'soft' : 'ghost'"
            icon="i-lucide-link"
            :aria-label="text.tools.link"
            :disabled="disabled"
            @click="openLink(editor)"
          />
          <template #content>
            <div class="w-64 space-y-2 p-3">
              <UInput
                v-model="linkUrl"
                size="sm"
                type="url"
                placeholder="https://"
                :aria-label="text.link"
                class="w-full"
                @keydown.enter.prevent="applyLink(editor)"
              />
              <div class="flex justify-end gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :label="text.linkRemove"
                  @click="removeLink(editor)"
                />
                <UButton size="xs" :label="text.linkApply" @click="applyLink(editor)" />
              </div>
            </div>
          </template>
        </UPopover>
      </template>
    </UEditorToolbar>
  </UEditor>
</template>
