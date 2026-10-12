// Migration ids are append-only (TSPACK-18): Migrator silently skips an id at or below the highest
// applied one, so CI rejects edited, removed or renamed migrations and new ids that do not exceed
// every existing id of their module.
// Usage: node scripts/lint-migrations.ts <base ref>   (e.g. origin/main)
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

const migrationFile = /^(?:packages|fixtures)\/.+\/migrations\/(\d+)_[^/]+\.ts$/

export interface Change {
  readonly status: string
  readonly path: string
}

export function lintMigrations(baseFiles: ReadonlyArray<string>, changes: ReadonlyArray<Change>) {
  const highest = new Map<string, number>()
  for (const file of baseFiles) {
    const id = migrationFile.exec(file)?.[1]
    if (id) highest.set(dirname(file), Math.max(highest.get(dirname(file)) ?? 0, Number(id)))
  }
  const errors: Array<string> = []
  const added = [...changes]
    .filter((c) => c.status === 'A')
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const change of changes) {
    if (change.status !== 'A' && migrationFile.test(change.path))
      errors.push(`${change.path}: applied migrations are append-only (status ${change.status})`)
  }
  for (const { path } of added) {
    const id = migrationFile.exec(path)?.[1]
    if (!id) continue
    const dir = dirname(path)
    const max = highest.get(dir) ?? 0
    if (Number(id) <= max) errors.push(`${path}: id ${Number(id)} must be greater than ${max}`)
    highest.set(dir, Math.max(max, Number(id)))
  }
  return errors
}

if (import.meta.main) {
  const base = process.argv[2]
  if (!base) throw new Error('Usage: node scripts/lint-migrations.ts <base ref>')
  const git = (...args: Array<string>) => execFileSync('git', args, { encoding: 'utf8' })
  const baseFiles = git('ls-tree', '-r', '--name-only', base).split('\n')
  // --no-renames: a rename shows as D + A, and the D already fails.
  const changes = git('diff', '--name-status', '--no-renames', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', path = ''] = line.split('\t')
      return { status: status.charAt(0), path }
    })
  const errors = lintMigrations(baseFiles, changes)
  for (const error of errors) console.error(error)
  process.exit(errors.length > 0 ? 1 : 0)
}
