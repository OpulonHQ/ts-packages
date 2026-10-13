export const EMPTY_PLACEHOLDER = '—'

/** `due_for_payment` / `dueForPayment` -> `Due for payment`. */
export const humanize = (value: string): string => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A language's name with a leading capital (`Slovenčina`, `Angličtina`), as a label stands
 * alone; in its own language by default. An unknown code comes back as is.
 */
export const languageName = (code: string, inLocale: string = code): string => {
  const name = new Intl.DisplayNames([inLocale], { type: 'language', fallback: 'none' }).of(code)
  return name ? name.charAt(0).toLocaleUpperCase(inLocale) + name.slice(1) : code
}

/** Reads a dotted path (`status.name`) from a row. */
export const getPath = (row: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row,
    )

export type BadgeColor =
  'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

// Generic lifecycle states only; a module passes `color` for its own vocabulary.
const statusColors: Record<string, BadgeColor> = {
  active: 'success',
  enabled: 'success',
  published: 'success',
  sent: 'success',
  delivered: 'success',
  completed: 'success',
  pending: 'warning',
  queued: 'warning',
  processing: 'warning',
  scheduled: 'info',
  new: 'info',
  failed: 'error',
  rejected: 'error',
  expired: 'error',
  inactive: 'neutral',
  disabled: 'neutral',
  draft: 'neutral',
  unpublished: 'neutral',
  archived: 'neutral',
}

/** A status value's badge color; unknown statuses are neutral. */
export const statusColor = (status: string | null | undefined): BadgeColor =>
  (status &&
    statusColors[
      status
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    ]) ||
  'neutral'
