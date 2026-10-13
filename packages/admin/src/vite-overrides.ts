import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { normalizePath, type Plugin, type ResolvedConfig } from 'vite'

const componentPrefix = '@opulonjs/ui/components/'
const sourceId = (id: string) => normalizePath(id.replace(/[?#].*$/, ''))
const versionPattern =
  '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*))?(?:\\+[\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*)?'
const semver = new RegExp(`^${versionPattern}$`)
const sourceComment = /^(?:<!-- (.*?) -->|\/\* (.*?) \*\/|\/\/ (.*))$/
const sourceHeader = /^@opulonjs\/source (@opulonjs\/[a-z0-9-]+)@(\S+) ([^\s]+)$/

interface SourceProvenance {
  readonly packageName: string
  readonly version: string
  readonly path: string
}

const provenance = (source: string): SourceProvenance | undefined => {
  const line = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const comment = sourceComment.exec(line)
  const header = comment?.[1] ?? comment?.[2] ?? comment?.[3]
  const match = header ? sourceHeader.exec(header) : null
  if (!match) return undefined
  const [, packageName, version, path] = match
  if (
    !packageName ||
    !version ||
    !path ||
    !semver.test(version) ||
    path.startsWith('/') ||
    path.split('/').includes('..')
  )
    return undefined
  return { packageName, version, path }
}

const newer = (installed: string, copied: string): boolean => {
  const left = semver.exec(installed)
  const right = semver.exec(copied)
  if (!left || !right) return false
  for (const index of [1, 2, 3]) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return false
    if (a !== b) return BigInt(a) > BigInt(b)
  }
  if (left[4] === right[4]) return false
  if (!left[4]) return true
  if (!right[4]) return false
  const a = left[4].split('.')
  const b = right[4].split('.')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (x === undefined) return false
    if (y === undefined) return true
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y)
    if (xNumeric !== yNumeric) return yNumeric
    return x > y
  }
  return false
}

export const adminOverrides = (
  components: Readonly<Record<string, string>>,
  packages: (root: string) => ReadonlyArray<string>,
): Plugin => {
  let config: ResolvedConfig
  const canonicalToHost = new Map<string, string>()
  const canonicalToOriginal = new Map<string, string>()
  const versions = new Map<string, string | undefined>()
  const warned = new Set<string>()
  const unchecked = new Set<string>()
  const missingHeaders = new Set<string>()
  const warnMissingHeader = (context: { warn: (message: string) => void }, file: string) => {
    if (missingHeaders.has(file)) return
    missingHeaders.add(file)
    context.warn(
      `opulonAdmin: ${file} is missing @opulonjs/source header; record the copied package version.`,
    )
  }

  return {
    name: '@opulonjs/admin-overrides',
    enforce: 'pre',
    config(user) {
      if (Object.keys(components).length)
        return {
          optimizeDeps: {
            exclude: [
              ...new Set([
                'effect',
                '@opulonjs/admin',
                '@opulonjs/ui',
                ...packages(resolve(user.root ?? '.')),
              ]),
            ],
          },
        }
    },
    configResolved(resolved) {
      config = resolved
      for (const [name, target] of Object.entries(components)) {
        if (!/^[A-Z][A-Za-z0-9]*(?:\/[A-Z][A-Za-z0-9]*)*$/.test(name))
          throw new Error(
            `opulonAdmin: invalid component override "${name}"; use a name like EmptyState or Field/Text`,
          )
        if (!target) throw new Error(`opulonAdmin: override "${name}" needs a host file path`)
        const file = normalizePath(isAbsolute(target) ? target : resolve(config.root, target))
        let isFile: boolean
        try {
          isFile = statSync(file).isFile()
        } catch {
          throw new Error(`opulonAdmin: override "${name}" host file is missing: ${file}`)
        }
        if (!isFile)
          throw new Error(`opulonAdmin: override "${name}" must point to a file: ${file}`)
        canonicalToHost.set(`${componentPrefix}${name}`, file)
      }
    },
    async buildStart() {
      canonicalToOriginal.clear()
      warned.clear()
      unchecked.clear()
      missingHeaders.clear()
      versions.clear()
      for (const [canonical, target] of canonicalToHost) {
        if (!provenance(readFileSync(target, 'utf8'))) warnMissingHeader(this, target)
        const original = await this.resolve(canonical, join(config.root, 'index.html'), {
          skipSelf: true,
        })
        if (!original || original.external)
          throw new Error(
            `opulonAdmin: unknown component override "${canonical}"; installed kit component could not be resolved`,
          )
        canonicalToOriginal.set(canonical, original.id)
      }
    },
    resolveId(id, importer) {
      if (id.includes('?') || id.includes('#')) return
      const canonical = canonicalToHost.get(id)
      if (canonical)
        return importer && sourceId(importer) === canonical
          ? canonicalToOriginal.get(id)
          : canonical
    },
    transform(source, id) {
      const file = normalizePath(id)
      if (
        file.includes('?') ||
        file.includes('/node_modules/') ||
        !/\.(vue|[cm]?[jt]sx?)$/.test(file)
      )
        return
      const header = provenance(source)
      const hostPath = normalizePath(relative(config.root, file))
      const screenCopy =
        canonicalToHost.size > 0 &&
        !isAbsolute(hostPath) &&
        !hostPath.startsWith('../') &&
        hostPath.split('/').slice(0, -1).includes('overrides')
      if (!header && screenCopy) warnMissingHeader(this, file)
      if (!header || warned.has(file)) return
      if (!versions.has(header.packageName)) {
        const resolvers = [
          createRequire(join(config.root, 'package.json')),
          createRequire(import.meta.url),
        ]
        const manifest = resolvers
          .map((require) => {
            try {
              return require.resolve(`${header.packageName}/package.json`)
            } catch {
              return undefined
            }
          })
          .find((path) => path !== undefined)
        const { version } = manifest
          ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown })
          : {}
        versions.set(header.packageName, typeof version === 'string' ? version : undefined)
      }
      const installed = versions.get(header.packageName)
      if (!installed && !unchecked.has(header.packageName)) {
        unchecked.add(header.packageName)
        this.warn(
          `@opulonjs/source: could not check installed version of ${header.packageName} for ${file}; add the package as a host dependency.`,
        )
      }
      if (installed && newer(installed, header.version)) {
        warned.add(file)
        this.warn(
          `@opulonjs/source: ${file} was copied from ${header.packageName}@${header.version} ${header.path}; installed version ${installed} is newer. Review the upstream changes.`,
        )
      }
    },
  }
}
