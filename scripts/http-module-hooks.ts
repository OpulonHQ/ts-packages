import type { LoadHook, ResolveHook } from 'node:module'

const viteClient = `const noop = () => {}
export const createHotContext = () => ({ data: {}, accept: noop, dispose: noop, prune: noop, invalidate: noop, on: noop, off: noop, send: noop })
export const updateStyle = noop, removeStyle = noop, injectQuery = (url) => url`

/** Node loader hooks that import modules from a dev server as a browser would; the HMR client is a stub. */
export const resolve: ResolveHook = (specifier, context, next) =>
  context.parentURL?.startsWith('http:') && !specifier.startsWith('node:')
    ? { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
    : next(specifier, context)

export const load: LoadHook = async (url, context, next) =>
  url.startsWith('http:')
    ? {
        format: 'module',
        shortCircuit: true,
        source: url.endsWith('/@vite/client') ? viteClient : await (await fetch(url)).text(),
      }
    : next(url, context)
