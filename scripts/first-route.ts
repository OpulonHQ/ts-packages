import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css' }

/**
 * The files a browser fetches for the admin's first route: serves a built admin (`dist`, base
 * `/admin/`), loads it in happy-dom signed in as `me` until the dashboard has rendered, and
 * returns every requested file plus the stylesheets and module preloads it links.
 */
export const firstRoute = async (dist: string, me: object): Promise<ReadonlyArray<string>> => {
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1]
  if (!entry) throw new Error('first route: no module script in index.html')
  const requested = new Set(
    [...html.matchAll(/<link rel="(?:stylesheet|modulepreload)"[^>]*href="([^"]+)"/g)].map(
      ([, href]) => href!.replace(/^\/admin\//, ''),
    ),
  )
  const server = createServer((request, response) => {
    const file = new URL(request.url ?? '/', 'http://x').pathname.replace(/^\/admin\//, '')
    requested.add(file)
    readFile(join(dist, file)).then(
      (body) => {
        response.writeHead(200, {
          'content-type': types[extname(file)] ?? 'application/octet-stream',
        })
        response.end(body)
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('first route: no server address')
    const page = spawn(
      process.execPath,
      [
        join(import.meta.dirname, 'first-route-page.ts'),
        `http://127.0.0.1:${address.port}`,
        entry,
        JSON.stringify(me),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let output = ''
    page.stdout.on('data', (chunk: Buffer) => (output += chunk))
    const code = await new Promise((done) => page.on('exit', done))
    if (code !== 0) throw new Error('first route: the admin dashboard did not render')
    const preloads = JSON.parse(output.trim().split('\n').at(-1) ?? '[]') as Array<string>
    for (const path of preloads) requested.add(path.replace(/^\/admin\//, ''))
  } finally {
    server.close()
  }
  return [...requested].sort()
}
