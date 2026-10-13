import { cmsNitroHooks } from '@opulonjs/cms/site/nuxt'
import worker from '../../../host/worker.ts'

export default defineNitroPlugin((nitro) => {
  const cms = cmsNitroHooks(worker)
  nitro.hooks.hook('request', cms.request)
  nitro.hooks.hook('render:response', cms.renderResponse)
  nitro.hooks.hook('render:route', cms.renderRoute)
})
