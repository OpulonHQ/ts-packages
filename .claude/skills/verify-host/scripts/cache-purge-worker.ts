import type { ScheduledEvent, WorkerContext } from '@opulonjs/core/workers'
import worker, { type Env } from '../../../../fixtures/host/worker.ts'

type CaptureEnv = Env & { readonly VERIFY_CACHE_PURGE: string }

const capture = (env: CaptureEnv, ctx: WorkerContext): WorkerContext => ({
  waitUntil: (work) => ctx.waitUntil(work),
  cache: {
    purge: async ({ tags }) => {
      const success = env.VERIFY_CACHE_PURGE === 'ok'
      console.log('verify-cache-purge', JSON.stringify({ tags, success }))
      return {
        success,
        errors: success ? [] : [{ code: 10000, message: 'fixture purge refused' }],
      }
    },
  },
})

export default {
  fetch: (request: Request, env: CaptureEnv, ctx: WorkerContext) =>
    worker.fetch(request, env, capture(env, ctx)),
  scheduled: (event: ScheduledEvent, env: CaptureEnv, ctx: WorkerContext) =>
    worker.scheduled(event, env, capture(env, ctx)),
}
