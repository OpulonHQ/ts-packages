import { cmsNitroPlugin } from '@opulonjs/cms/site/nuxt'
import worker from '../../../host/worker.ts'

export default defineNitroPlugin(cmsNitroPlugin(worker))
