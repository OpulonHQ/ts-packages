/** The part of a Workers static assets binding (`env.ASSETS`) the admin helper uses. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

const withCacheControl = (response: Response, value: string) => {
  const copy = new Response(response.body, response)
  copy.headers.set('cache-control', value)
  return copy
}

/**
 * Serves the host-built admin SPA from static assets (TSPACK-8 decision 3). Returns undefined
 * outside `/admin`. Hashed `/admin/assets/*` files are immutable; other existing files pass
 * through as the binding serves them (304 included); every other path (and any `.html`) gets `index.html`
 * with `no-store`, so a deploy never leaves editors on a stale shell. Expects the binding to
 * serve files by exact path (wrangler `assets.html_handling: "none"`).
 */
export const serveAdmin = async (
  request: Request,
  assets: AssetsBinding,
): Promise<Response | undefined> => {
  const url = new URL(request.url)
  const path = url.pathname
  if (path !== '/admin' && !path.startsWith('/admin/')) return undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined

  if (path.startsWith('/admin/assets/')) {
    const file = await assets.fetch(request)
    return file.ok ? withCacheControl(file, 'public, max-age=31536000, immutable') : file
  }
  if (!path.endsWith('/') && !path.endsWith('.html') && path !== '/admin') {
    const file = await assets.fetch(request)
    // Only a missing file falls back to the SPA: a 304 revalidation is still this file.
    if (file.status !== 404) return file
  }
  const index = await assets.fetch(new Request(new URL('/admin/index.html', url), request))
  return withCacheControl(index, 'no-store')
}
