import { computed, type ComputedRef, onBeforeUnmount, type WritableComputedRef } from 'vue'
import { type ShellEditor, useAdmin } from './state.ts'

/**
 * What a form holds, minus what an untouched form writes on its own: `null`, `undefined`, `''`,
 * `false`, `[]` and `{}` (nested too) count as empty. Array items keep their place, so moving or
 * adding a section is a change. `undefined` stands for empty.
 */
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
  /**
   * Keep asking before leaving while busy, for a save of several requests that leaving would cut
   * short (default: a save in flight carries the changes, so leaving does not ask).
   */
  readonly guardWhileBusy?: boolean
  /**
   * The element holding the form, for an editor inside a dialog (a slideover): Cmd/Ctrl+S saves
   * while that dialog is open, but not behind another dialog over it (a delete confirmation).
   */
  readonly within?: () => Element | null | undefined
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
    guardWhileBusy: options.guardWhileBusy ?? false,
    ...(options.within ? { within: options.within } : {}),
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

export interface CloseGuardOptions {
  /** Whether the slideover (or modal) holding the form is open. */
  readonly isOpen: () => boolean
  /** Closes it; what the form holds is dropped. */
  readonly close: () => void
  /** The form holds unsaved changes. */
  readonly dirty: () => boolean
}

export interface CloseGuard {
  /** For `v-model:open`: its × closes through `close`. */
  readonly open: WritableComputedRef<boolean>
  /** For `:dismissible`: false while unsaved, so Escape and an outside click emit `close:prevent`. */
  readonly dismissible: ComputedRef<boolean>
  /** Cancel and `@close:prevent`: asks while unsaved, then closes. */
  readonly close: () => Promise<void>
  /**
   * Before the form is replaced (another row, a new record): asks while unsaved; true to go on.
   * While a modal slideover is open its overlay keeps the rows and buttons behind it out of reach,
   * so a row click or a "New" button reaches this with a form open only from code (a test, a
   * non-modal slideover): a safeguard, not a path users take today.
   */
  readonly leave: () => Promise<boolean>
}

/**
 * A slideover holding a small record's form: every way of closing it (Cancel, ×, Escape, an
 * outside click) and every switch to another record asks "Discard unsaved changes?" first while
 * the form has unsaved changes, and closes at once while it has none.
 *
 * const { open, dismissible, close, leave } = useCloseGuard({
 *   isOpen: () => form.value !== undefined, close: () => (form.value = undefined),
 *   dirty: () => changes.dirty.value,
 * })
 * <USlideover v-model:open="open" :dismissible="dismissible" @close:prevent="close">
 */
export const useCloseGuard = (options: CloseGuardOptions): CloseGuard => {
  const admin = useAdmin()
  // One question at a time: a request while it is open does nothing (the slideover can emit
  // close:prevent while the question opens), so "Discard changes" on a row switch opens that row
  // instead of also closing the slideover.
  let asking = false
  const leave = async () => {
    if (!options.dirty()) return true
    if (asking) return false
    asking = true
    try {
      return await admin.confirmDiscard()
    } finally {
      asking = false
    }
  }
  const close = async () => {
    if (await leave()) options.close()
  }
  return {
    open: computed({
      get: options.isOpen,
      set: (open) => {
        if (!open) void close()
      },
    }),
    dismissible: computed(() => !options.dirty()),
    close,
    leave,
  }
}
