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

export const toDate = (value: unknown): Date | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** A moment as the native date inputs hold it, in local time: `2026-11-07T14:37`. */
export const localIso = (date: Date): string => {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A file size in the largest fitting unit (`4 B`, `1.5 MB`). */
export const formatBytes = (bytes: number, locale: string): string => {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte']
  const power = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), 3)
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[power],
    maximumFractionDigits: 1,
  }).format(bytes / 1024 ** power)
}

/** A day the way every admin list shows it (`Nov 7, 2026`, `7. 11. 2026`); empty: `—`. */
export const formatDate = (value: unknown, locale: string): string => {
  const date = toDate(value)
  return date
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
    : EMPTY_PLACEHOLDER
}

/** A moment in local time, for logs and histories (`Nov 7, 2026, 2:37 PM`); empty: `—`. */
export const formatDateTime = (value: unknown, locale: string): string => {
  const date = toDate(value)
  return date
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : EMPTY_PLACEHOLDER
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
