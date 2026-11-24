const encodeStep = 0x8000 - (0x8000 % 3)
const decodeStep = 0x10000

export const encodeBase64 = (bytes: Uint8Array) => {
  const parts: Array<string> = []
  for (let start = 0; start < bytes.length; start += encodeStep)
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + encodeStep))))
  return parts.join('')
}

export const decodeBase64 = (text: string) => {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  let offset = 0
  for (let start = 0; start < text.length; start += decodeStep) {
    const binary = atob(text.slice(start, start + decodeStep))
    for (let i = 0; i < binary.length; i++) bytes[offset++] = binary.charCodeAt(i)
  }
  return bytes
}
