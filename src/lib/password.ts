import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const PREFIX = 'scrypt$'
const KEY_LENGTH = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error)
      else resolve(key as Buffer)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  return `${PREFIX}${salt.toString('hex')}$${key.toString('hex')}`
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(left)
  const rightHash = Buffer.from(right)
  const leftDigest = createHash('sha256').update(leftHash).digest()
  const rightDigest = createHash('sha256').update(rightHash).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!storedPassword.startsWith(PREFIX)) {
    return { valid: constantTimeTextEqual(password, storedPassword), needsRehash: true }
  }

  const [saltHex, keyHex, extra] = storedPassword.slice(PREFIX.length).split('$')
  if (!saltHex || !keyHex || extra !== undefined || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) {
    return { valid: false, needsRehash: false }
  }

  const expectedKey = Buffer.from(keyHex, 'hex')
  const actualKey = await deriveKey(password, Buffer.from(saltHex, 'hex'))
  return {
    valid: timingSafeEqual(actualKey, expectedKey),
    needsRehash: false,
  }
}
