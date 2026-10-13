import worker from '../../../host/worker.ts'

// One Worker serves the site and the composed API: /api/** goes to the fixture host in-process.
export default defineEventHandler((event) => {
  const cloudflare = event.context.cloudflare
  if (!cloudflare || !event.path.startsWith('/api/')) return
  return worker.fetch(toWebRequest(event), cloudflare.env, cloudflare.context)
})
