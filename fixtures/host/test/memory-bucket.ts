import type { R2BucketLike } from '@opulonjs/media/server'

/** An in-memory stand-in for the MEDIA_BUCKET R2 binding (the subset media uses). */
export const memoryBucket = () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const meta = (key: string) => {
    const object = objects.get(key)
    return object
      ? {
          size: object.bytes.length,
          httpEtag: `"${key}"`,
          httpMetadata: { contentType: object.contentType },
        }
      : null
  }
  const bucket: R2BucketLike & { readonly keys: () => Array<string> } = {
    put: async (key, value, options) => {
      objects.set(key, { bytes: value.slice(), contentType: options.httpMetadata.contentType })
    },
    get: async (key) => {
      const object = objects.get(key)
      return object ? { ...meta(key)!, body: new Response(object.bytes.slice()).body! } : null
    },
    head: async (key) => meta(key),
    keys: () => [...objects.keys()],
  }
  return bucket
}
