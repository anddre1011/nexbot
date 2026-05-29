import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required for token encryption')
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length === 32) return decoded

  return crypto.createHash('sha256').update(raw).digest()
}

export function encryptSecret(value: string | null | undefined): string | null {
  if (!value) return null

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('v1:')) return value

  const [, ivRaw, authTagRaw, encryptedRaw] = value.split(':')
  if (!ivRaw || !authTagRaw || !encryptedRaw) {
    throw new Error('Invalid encrypted secret format')
  }

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64url'), {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(Buffer.from(authTagRaw, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
