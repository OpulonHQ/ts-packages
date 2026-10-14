import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { gt, valid } from 'semver'
import { normalizePath, type Plugin, type ResolvedConfig } from 'vite'

const componentPrefix = '@opulonjs/ui/components/'
const sourceId = (id: string) => normalizePath(id.replace(/[?#].*$/, ''))
const sourceComment = /^(?:<!-- (.*?) -->|\/\* (.*?) \*\/|\/\/ (.*))$/
const sourceHeader = /^@opulonjs\/source (@opulonjs\/[a-z0-9-]+)@(\S+) ([^\s]+)$/

interface SourceProvenance {
  readonly packageName: string
  readonly version: string
  readonly path: string
}

const provenance = (source: string): SourceProvenance | 'invalid' | undefined => {
  const line = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const comment = sourceComment.exec(line)
  const header = comment?.[1] ?? comment?.[2] ?? comment?.[3]
  if (!header?.startsWith('@opulonjs/source')) return undefined
  const match = sourceHeader.exec(header)
  if (!match) return 'invalid'
  const [, packageName, version, path] = match
  if (
    !packageName ||
    !version ||
    !path ||
    valid(version) !== version.split('+')[0] ||
    path.startsWith('/') ||
    path.split('/').includes('..')
  )
    return 'invalid'
  return { packageName, version, path }
}

export const adminOverrides = (
  overrides: { readonly components?: Readonly<Record<string, string>> } | undefined,
): Plugin => {
  const components = overrides?.components ?? {}
  let config: ResolvedConfig
  const canonicalToHost = new Map<string, string>()
  const canonicalToOriginal = new Map<string, string>()
  const versions = new Map<string, string | undefined>()
  const warned = new Set<string>()
  const unchecked = new Set<string>()
  const headerWarnings = new Set<string>()
  const warnHeader = (
    context: { warn: (message: string) => void },
    file: string,
    header: 'invalid' | undefined,
  ) => {
    if (headerWarnings.has(file)) return
    headerWarnings.add(file)
    context.warn(
      header === 'invalid'
        ? `opulonAdmin: ${file} has an invalid @opulonjs/source header; use @opulonjs/source <package>@<exact SemVer> <path in the package>.`
        : `opulonAdmin: ${file} is missing @opulonjs/source header; record the copied package version.`,
    )
  }

  return {
    name: '@opulonjs/admin-overrides',
    enforce: 'pre',
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
      headerWarnings.clear()
      versions.clear()
      for (const [canonical, target] of canonicalToHost) {
        const header = provenance(readFileSync(target, 'utf8'))
        if (!header || header === 'invalid') warnHeader(this, target, header)
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
      if (!overrides) return
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
        !isAbsolute(hostPath) &&
        !hostPath.startsWith('../') &&
        hostPath.split('/').slice(0, -1).includes('overrides')
      if (header === 'invalid' || (!header && screenCopy)) warnHeader(this, file, header)
      if (!header || header === 'invalid' || warned.has(file)) return
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
      if (installed && gt(installed, header.version)) {
        warned.add(file)
        this.warn(
          `@opulonjs/source: ${file} was copied from ${header.packageName}@${header.version} ${header.path}; installed version ${installed} is newer. Review the upstream changes.`,
        )
      }
    },
  }
}
