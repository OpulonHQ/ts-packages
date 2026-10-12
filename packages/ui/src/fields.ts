/** Props every `Field/*` component shares; each wraps a `UFormField`. */
export interface FieldProps {
  /** Form state key; must match the schema path so `UForm` shows its errors. */
  name: string
  label?: string
  /** Below the label. */
  description?: string
  /** Below the control. */
  help?: string
  /** Next to the label, e.g. "Optional". */
  hint?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}

export interface SelectItem {
  label: string
  value: string | number
}

/** Toolbar buttons of `RichTextControl`; the format is restricted to these marks and nodes. */
export type RichTextButton =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'h2'
  | 'h3'
  | 'blockquote'
  | 'undo'
  | 'redo'

export const defaultRichTextToolbar: ReadonlyArray<RichTextButton> = [
  'bold',
  'italic',
  'underline',
  'strike',
  'link',
  'bulletList',
  'orderedList',
  'h2',
  'h3',
  'blockquote',
  'undo',
  'redo',
]
