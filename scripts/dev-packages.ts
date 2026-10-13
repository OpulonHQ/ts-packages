import { readFileSync } from 'node:fs'
import type { ViteDevServer } from 'vite'

const packageOf = (path: string) =>
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]

/**
 * The packages a dev server serves from `entry` both prebundled and raw: each of them runs as two
 * instances that reject each other's values (Effect schemas, Vue injection keys).
 */
export const packagesLoadedTwice = async (vite: ViteDevServer, entry: string) => {
  const graph = vite.environments.client.moduleGraph
  const raw = new Set<string>()
  const seen = new Set([entry])
  for (let frontier = [entry]; frontier.length > 0;) {
    const imported = await Promise.all(
      frontier.map(async (url) => {
        await vite.transformRequest(url)
        // Stylesheet edges are Tailwind's content sources, not modules the page loads.
        if (/\.css(?:$|\?)/.test(url)) return []
        return [...((await graph.getModuleByUrl(url))?.importedModules ?? [])]
      }),
    )
    frontier = []
    for (const { url, file } of imported.flat()) {
      if (seen.has(url) || url.includes('/.vite/deps/')) continue
      seen.add(url)
      const name = file ? packageOf(file) : undefined
      if (name) raw.add(name)
      frontier.push(url)
    }
  }
  const optimizer = vite.environments.client.depsOptimizer!
  optimizer.run()
  await Promise.all(Object.values(optimizer.metadata.discovered).map((dep) => dep.processing))
  const { optimized, chunks } = optimizer.metadata
  const bundled = new Set(
    [...Object.values(optimized), ...Object.values(chunks)].flatMap(({ file }) =>
      [...readFileSync(file, 'utf8').matchAll(/^\/\/#region (.+)$/gm)].flatMap(
        (match) => packageOf(match[1]!) ?? [],
      ),
    ),
  )
  return { raw, bundled, twice: [...raw].filter((name) => bundled.has(name)) }
}
