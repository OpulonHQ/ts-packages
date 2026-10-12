import { Context, Layer } from 'effect'

/**
 * Builds resized image URLs from an original's URL. The only image-processing swap point: the
 * default uses Cloudflare zone Image Transformations (`/cdn-cgi/image/...`, enable them on the
 * zone); a non-Cloudflare runtime provides another implementation through `media({ imageUrl })`.
 */
export class ImageUrl extends Context.Service<
  ImageUrl,
  {
    /** The original resized to `width` pixels wide. */
    readonly url: (original: string, width: number) => string
  }
>()('@opulonjs/media/ImageUrl') {
  static readonly cloudflare: ImageUrl['Service'] = {
    url: (original, width) => `/cdn-cgi/image/width=${width},format=auto${original}`,
  }

  static readonly layer = (service: ImageUrl['Service'] = ImageUrl.cloudflare) =>
    Layer.succeed(ImageUrl, service)
}

/**
 * A `srcset` for an image `width` pixels wide: one candidate per host width below it, plus the
 * original width (never upscaled). Empty when the width is unknown.
 */
export const srcset = (
  imageUrl: ImageUrl['Service'],
  original: string,
  width: number | null,
  widths: ReadonlyArray<number>,
): string => {
  if (width === null) return ''
  const candidates = [...new Set([...widths.filter((w) => w < width), width])].sort((a, b) => a - b)
  return candidates.map((w) => `${imageUrl.url(original, w)} ${w}w`).join(', ')
}
