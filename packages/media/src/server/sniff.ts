import { imageSize } from 'image-size'
import { type MediaMime, mediaMimeTypes } from '../api.ts'

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end))
const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>) =>
  signature.every((byte, i) => bytes[i] === byte)

/** The allowlisted type the bytes are, by magic bytes; undefined for anything else. */
export const sniff = (bytes: Uint8Array): MediaMime | undefined => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  // ISO BMFF with the AVIF major brand; other brands (mp4, mov, heic) are video or unsupported.
  if (ascii(bytes, 4, 12) === 'ftypavif') return 'image/avif'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
  return undefined
}

export const isAllowedMime = (mime: string): mime is MediaMime =>
  (mediaMimeTypes as ReadonlyArray<string>).includes(mime)

/**
 * Display dimensions of an image (EXIF rotation applied), or undefined when the header cannot
 * be read. `image-size` reads headers only; no pixel data is decoded.
 */
export const dimensions = (bytes: Uint8Array): { width: number; height: number } | undefined => {
  try {
    const { width, height, orientation } = imageSize(bytes)
    // EXIF orientations 5-8 rotate by 90 degrees: the displayed image is height x width.
    return orientation !== undefined && orientation >= 5
      ? { width: height, height: width }
      : { width, height }
  } catch {
    return undefined
  }
}

export const extensions: Readonly<Record<MediaMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

/**
 * A URL-safe filename: ASCII letters, digits, `-` and `_`, max 80 characters, with the
 * extension of the sniffed type (never the uploaded one).
 */
export const safeFilename = (name: string, mime: MediaMime): string => {
  const base = name
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'file'}.${extensions[mime]}`
}
