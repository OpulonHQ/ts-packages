import { expect, test } from 'vitest'
import { decodeBase64, encodeBase64 } from '../src/server/base64.ts'

test.each([0, 1, 2, 3, 32765, 32766, 32767, 49152, 49153, 200_001])(
  '%i bytes encode to standard Base64 and decode back',
  (size) => {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 7) % 256)
    const text = encodeBase64(bytes)
    expect(text).toBe(Buffer.from(bytes).toString('base64'))
    expect(Buffer.from(decodeBase64(text)).equals(bytes)).toBe(true)
  },
)
