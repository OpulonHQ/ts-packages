import bcrypt from 'bcryptjs'

// PBKDF2-SHA256 through WebCrypto (TSPACK-10): Better Auth's default scrypt runs as pure JS on
// Workers. 100,000 iterations is the most workerd's PBKDF2 accepts. Stored as
// `pbkdf2v1:` + base64(16-byte salt || 32-byte key); the prefix versions the format.
const prefix = 'pbkdf2v1:'
const iterations = 100_000
const encoder = new TextEncoder()
const bcryptPattern = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/

/** Whether a stored hash is in the format `hashPassword` writes. */
export const isCurrentHash = (hash: string) => hash.startsWith(prefix)

/** Whether sign-in can verify a stored hash: the current format, or bcrypt (`$2a$`, `$2b$`, `$2y$`). */
export const isVerifiableHash = (hash: string) => isCurrentHash(hash) || bcryptPattern.test(hash)

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, key, 256),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bytes = new Uint8Array(48)
  bytes.set(salt)
  bytes.set(await derive(password, salt), 16)
  return prefix + btoa(String.fromCharCode(...bytes))
}

/** SHA-256 hex of a string: stored in place of tokens, and as a session's password stamp. */
export const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

/** False for anything that is neither the current format nor bcrypt, including malformed hashes. */
export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  if (bcryptPattern.test(input.hash)) return bcrypt.compare(input.password, input.hash)
  if (!isCurrentHash(input.hash)) return false
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = Uint8Array.from(atob(input.hash.slice(prefix.length)), (c) => c.charCodeAt(0))
  } catch {
    return false // not base64: a malformed hash never verifies
  }
  if (bytes.length !== 48) return false
  const actual = await derive(input.password, bytes.slice(0, 16))
  // Fixed-length comparison; no exit on the first mismatching byte.
  let difference = 0
  for (let i = 0; i < 32; i++) difference |= actual[i]! ^ bytes[i + 16]!
  return difference === 0
}
