import { computed, type ComputedRef, onBeforeUnmount } from 'vue'
import { type ShellEditor, useAdmin } from './state.ts'

export const normalized = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '' || value === false) return undefined
  if (Array.isArray(value)) return value.length === 0 ? undefined : value.map(normalized)
  if (typeof value === 'object') {
    const kept = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, normalized(inner)] as const)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return kept.length === 0 ? undefined : Object.fromEntries(kept)
  }
  return value
}

/** Whether two form values hold the same content (see `normalized`). */
export const sameContent = (a: unknown, b: unknown): boolean =>
  JSON.stringify(normalized(a) ?? null) === JSON.stringify(normalized(b) ?? null)

export interface UnsavedChangesOptions {
  /** What is on screen. */
  readonly current: () => unknown
  /** What was last saved, in the same shape: a copy taken when the editor showed it. */
  readonly saved: () => unknown
  /** Saves what is on screen: the bar's Save and Cmd/Ctrl+S. */
  readonly save: () => unknown
  /** Puts the saved values back on screen, without a request. */
  readonly discard: () => void
  /** True while the editor's request runs: the bar waits and the shortcut does nothing. */
  readonly busy?: () => boolean
  /** The bar's save button; default "Save" ("Save draft" where publishing is a separate step). */
  readonly saveLabel?: () => string
  /** False for an editor with its own buttons (a slideover's footer): guard and shortcut only. */
  readonly bar?: boolean
}

export interface UnsavedChanges {
  /** What is on screen differs from what was saved. */
  readonly dirty: ComputedRef<boolean>
  /**
   * Asks before something replaces the edits without navigating (another row, closing a
   * slideover); true at once when nothing is unsaved.
   */
  readonly confirmDiscard: () => Promise<boolean>
}

/**
 * An editor's unsaved changes, for the whole admin to see: the shell shows the bar with Save and
 * Discard while they exist, asks before navigating away or reloading, and saves on Cmd/Ctrl+S.
 *
 * const changes = useUnsavedChanges({
 *   current: () => draft.value, saved: () => baseline.value,
 *   save, discard: () => (draft.value = structuredClone(baseline.value)),
 *   busy: () => pending.value, saveLabel: () => t('cms.page.save'),
 * })
 */
export const useUnsavedChanges = (options: UnsavedChangesOptions): UnsavedChanges => {
  const admin = useAdmin()
  const dirty = computed(() => !sameContent(options.current(), options.saved()))
  const editor: ShellEditor = {
    dirty: () => dirty.value,
    busy: () => options.busy?.() ?? false,
    save: options.save,
    discard: options.discard,
    saveLabel: options.saveLabel,
    bar: options.bar ?? true,
  }
  onBeforeUnmount(admin.registerEditor(editor))
  return {
    dirty,
    confirmDiscard: () => (dirty.value ? admin.confirmDiscard() : Promise.resolve(true)),
  }
}

/**
 * Adds unsaved state that saves on its own (a widget with its own Save button) to the leave
 * guard, without the bar.
 */
export const useLeaveGuard = (dirty: () => boolean): void => {
  onBeforeUnmount(useAdmin().registerEditor({ dirty, busy: () => false, bar: false }))
}
