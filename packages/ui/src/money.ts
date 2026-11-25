export const minorDigits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2

export const parseMoney = (input: string, digits: number): number | null | 'invalid' => {
  const typed = input.trim()
  if (typed === '' || typed === '-') return null
  const match = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(typed)
  if (!match || (match[3]?.length ?? 0) > digits) return 'invalid'
  const minor = Number(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(digits, '0')}`)
  return Number.isSafeInteger(minor) ? minor : 'invalid'
}

export const formatMinor = (minor: number, digits: number, separator: string): string => {
  const all = String(Math.abs(minor)).padStart(digits + 1, '0')
  const whole = all.slice(0, all.length - digits)
  return `${minor < 0 ? '-' : ''}${whole}${digits > 0 ? separator + all.slice(-digits) : ''}`
}
