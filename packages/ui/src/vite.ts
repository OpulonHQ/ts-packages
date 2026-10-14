import nuxtUi from '@nuxt/ui/vite'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, PluginOption } from 'vite'

type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950
type NuxtUiOptions = NonNullable<Parameters<typeof nuxtUi>[0]>

/** Build-time brand of a host's admin (TSPACK-9): no runtime brand CSS. */
export interface Brand {
  /** App name in the sidebar and the document title. */
  readonly name: string
  /** Logo URL, usually a file in the admin's `public/` (`/admin/logo.svg`). */
  readonly logo?: string
  /**
   * Semantic colors to Tailwind palettes, e.g. `{ primary: 'indigo', neutral: 'slate' }`; a
   * name from `palettes` works too. Default: the `neutral` grays, and a primary that is black
   * in light mode and white in dark mode.
   */
  readonly colors?: Readonly<Record<string, string>>
  /** Custom palettes, every shade required: `{ brand: { 50: '#...', ..., 950: '#...' } }`. */
  readonly palettes?: Readonly<Record<string, Readonly<Record<Shade, string>>>>
  /** Base radius, e.g. `0.5rem` (Nuxt UI `--ui-radius`). */
  readonly radius?: string
  /**
   * Font family; default the self-hosted Inter. A host font must be loaded by the host too
   * (e.g. `import '@fontsource-variable/roboto'` in its admin entry).
   */
  readonly font?: string
  /** Nuxt UI component slot, variant and default overrides (`ui.<component>`). */
  readonly ui?: Omit<NonNullable<NuxtUiOptions['ui']>, 'colors'>
}

export interface UiPresetOptions {
  readonly brand?: Brand
  /**
   * Directories outside the Vite root with templates or scripts: Tailwind scans them for
   * classes, and their `i-lucide-*` names join the offline icon bundle. The kit adds itself.
   * A function gets the resolved Vite root.
   */
  readonly sources?: ReadonlyArray<string> | ((root: string) => ReadonlyArray<string>)
}

/** The virtual stylesheet the admin entry imports: Tailwind, Nuxt UI, the font and the brand. */
export const stylesId = 'virtual:opulon-ui.css'
const iconsId = 'virtual:opulon-ui-icons'

// `src/` in the repo, `dist/` when installed.
const kitDir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// Nuxt UI's own default icons (chevrons, close, loading, ...) are Lucide names in its runtime.
const nuxtUiDir = dirname(fileURLToPath(import.meta.resolve('@nuxt/ui/vite')))
const semanticColors = ['primary', 'secondary', 'success', 'info', 'warning', 'error']
// Black-and-white primary over achromatic grays; the CSS overrides --ui-primary itself, the
// palette only backs primary's shade utilities.
const defaultColors = { primary: 'neutral', neutral: 'neutral' }
const lucide = /\bi-lucide-[a-z0-9]+(?:-[a-z0-9]+)*/g
const skip = new Set(['node_modules', 'dist', 'public'])

/** Every `i-lucide-*` name in a directory's sources, skipping dependencies. */
const iconsIn = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? skip.has(entry.name) || entry.name.startsWith('.')
        ? []
        : iconsIn(join(dir, entry.name))
      : /\.(vue|[cm]?[jt]s)$/.test(entry.name)
        ? (readFileSync(join(dir, entry.name), 'utf8').match(lucide) ?? [])
        : [],
  )

interface IconSet {
  readonly prefix: string
  readonly width?: number
  readonly height?: number
  readonly icons: Readonly<Record<string, unknown>>
  readonly aliases?: Readonly<Record<string, { readonly parent: string }>>
}

/** The Lucide icons named in `names` (with alias parents), as an Iconify JSON subset. */
const lucideSubset = (names: ReadonlySet<string>): IconSet => {
  const set = JSON.parse(
    readFileSync(require.resolve('@iconify-json/lucide/icons.json'), 'utf8'),
  ) as IconSet
  const wanted = [...names].map((name) => name.slice('i-lucide-'.length))
  const aliases = Object.fromEntries(
    wanted.flatMap((name) => (set.aliases?.[name] ? [[name, set.aliases[name]]] : [])),
  )
  const icons = Object.fromEntries(
    [...wanted, ...Object.values(aliases).map((a) => a.parent)].flatMap((name) =>
      set.icons[name] ? [[name, set.icons[name]]] : [],
    ),
  )
  return { ...set, icons, aliases }
}

// Tailwind 4 resets buttons to the default cursor; everything clickable gets the pointer again,
// table rows with a row action (Nuxt UI marks them data-selectable) included.
// In the base layer, so a component's own cursor utility (cursor-not-allowed) still wins.
const pointer = `@layer base {
  :is(button, [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'],
    [role='option'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], summary,
    select, label[for], input[type='checkbox'], input[type='radio'], input[type='file'],
    input[type='submit'], input[type='button'], a[href],
    tr[data-selectable='true']):not(:disabled, [aria-disabled='true'], [data-disabled]) {
    cursor: pointer;
  }
}`

const css = (brand: Brand | undefined, sources: ReadonlyArray<string>): string =>
  [
    '@import "tailwindcss";',
    '@import "@nuxt/ui";',
    brand?.font ? '' : '@import "@fontsource-variable/inter";',
    ...sources.map((dir) => `@source "${dir}";`),
    ...Object.entries(brand?.palettes ?? {}).map(
      ([name, shades]) =>
        `@theme static {\n${Object.entries(shades)
          .map(([shade, value]) => `  --color-${name}-${shade}: ${value};`)
          .join('\n')}\n}`,
    ),
    pointer,
    `@theme {\n  --font-sans: ${brand?.font ? `"${brand.font}"` : '"Inter Variable"'}, ui-sans-serif, system-ui, sans-serif;\n}`,
    brand?.radius ? `:root {\n  --ui-radius: ${brand.radius};\n}` : '',
    brand?.colors?.primary
      ? ''
      : ':root {\n  --ui-primary: black;\n}\n.dark {\n  --ui-primary: white;\n}',
  ]
    .filter(Boolean)
    .join('\n')

/**
 * Rolldown chunk group for the rich text editor's ProseMirror code, which otherwise shares one
 * chunk with tiptap above Vite's 500 kB warning. Opt in from the host's Vite config:
 * `build: { rolldownOptions: { output: { codeSplitting: { groups: [editorChunkGroup] } } } }`.
 */
export const editorChunkGroup = { name: 'prosemirror', test: /[\\/]prosemirror-[a-z-]+[\\/]/ }

/**
 * Nuxt UI 4 for a plain Vue/Vite SPA, branded at build time: Tailwind, the theme and component
 * overrides, the self-hosted Inter font and an offline Lucide icon bundle. Add `@vitejs/plugin-vue`
 * next to it; `@opulonjs/admin/vite` does both.
 */
export const opulonUi = (options: UiPresetOptions = {}): Array<PluginOption> => {
  // Resolved with the Vite root (configResolved runs before any load).
  let sources: ReadonlyArray<string> = [kitDir]
  const { brand } = options
  // A real path inside this package, so the stylesheet's bare imports resolve from here.
  const stylesPath = join(kitDir, '__opulon-ui.css')
  const styles: Plugin = {
    name: '@opulonjs/ui:styles',
    enforce: 'pre',
    // Nuxt UI keeps itself out of prebundling; a prebundled kit would import it from the host
    // root, where a strict (pnpm) install does not have it.
    config: () => ({ optimizeDeps: { exclude: ['@opulonjs/ui'] } }),
    resolveId: (id) => (id === stylesId ? stylesPath : undefined),
    load: (id) => (id === stylesPath ? css(brand, sources) : undefined),
  }
  // The offline icon bundle `uiPlugin` registers: every Lucide name in the kit, the sources,
  // Nuxt UI and the host's own files. Nuxt UI's bundler resolves the collection from the host
  // root (where it is not installed), so it is off.
  // ponytail: scanned once per start; restart the dev server after adding a new icon name.
  let root = process.cwd()
  const icons: Plugin = {
    name: '@opulonjs/ui:icons',
    enforce: 'pre',
    configResolved: (config) => {
      root = config.root
      const extra = typeof options.sources === 'function' ? options.sources(root) : options.sources
      sources = [kitDir, ...(extra ?? [])]
    },
    resolveId: (id) => (id === iconsId ? `\0${iconsId}` : undefined),
    load: (id) => {
      if (id !== `\0${iconsId}`) return undefined
      const names = new Set([nuxtUiDir, root, ...sources].flatMap(iconsIn))
      return `export default ${JSON.stringify(lucideSubset(names))}`
    },
  }
  return [
    styles,
    icons,
    nuxtUi({
      dts: false,
      router: true,
      ui: { ...brand?.ui, colors: { ...defaultColors, ...brand?.colors } },
      theme: {
        colors: [
          ...new Set(
            [...semanticColors, ...Object.keys(brand?.colors ?? {})].filter((c) => c !== 'neutral'),
          ),
        ],
      },
      icon: { clientBundle: false },
    }),
  ]
}
