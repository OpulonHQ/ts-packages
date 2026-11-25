/** Decimal places of an ISO 4217 currency's minor unit: 2 for EUR, 0 for JPY, 3 for KWD. */
export const minorDigits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2

/**
 * A typed decimal amount as integer minor units, read digit by digit so no float rounds it
 * (`1.15` is 115). Empty is null; text that is not an amount with at most `digits` decimals, or
 * one past the safe integers, is undefined.
 */
export const parseMoney = (input: string, digits: number): number | null | undefined => {
  const typed = input.trim()
  if (typed === '') return null
  const match = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(typed)
  if (!match || (match[3]?.length ?? 0) > digits) return undefined
  const minor = Number(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(digits, '0')}`)
  return Number.isSafeInteger(minor) ? minor : undefined
}

/** Minor units as a decimal amount without grouping: 1250 with 2 digits is `12.50`. */
export const formatMinor = (minor: number, digits: number, separator: string): string => {
  const all = String(Math.abs(minor)).padStart(digits + 1, '0')
  const whole = all.slice(0, all.length - digits)
  return `${minor < 0 ? '-' : ''}${whole}${digits > 0 ? separator + all.slice(-digits) : ''}`
}
