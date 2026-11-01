import { createHash } from 'node:crypto'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type DniImageKind = 'foto' | 'firma'

const R2_PREFIX = 'dni-images'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 10 * 60

type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

let cachedClient: S3Client | null = null

export function getR2Config(): R2Config | null {
  const values = {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    bucket: process.env.CLOUDFLARE_R2_BUCKET,
  }
  const hasAnyValue = Object.values(values).some(Boolean)
  if (!hasAnyValue) return null

  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) {
    throw new Error(`Faltan variables de Cloudflare R2: ${missing.join(', ')}`)
  }

  return values as R2Config
}

export function isR2WriteEnabled(): boolean {
  if (process.env.CLOUDFLARE_R2_WRITE_ENABLED !== 'true') return false
  if (!getR2Config()) throw new Error('R2_WRITE_ENABLED requiere las credenciales completas de Cloudflare R2')
  return true
}

function getR2Client(config: R2Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }
  return cachedClient
}

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('La imagen debe estar en formato PNG, JPEG o WebP')

  const contentType = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('La imagen está vacía o supera el límite de 10 MB')
  }

  const isPng = contentType === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = contentType === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isWebp = contentType === 'image/webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (!isPng && !isJpeg && !isWebp) throw new Error('El contenido de la imagen no coincide con su formato')

  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  return { buffer, contentType, extension }
}

function getImageKey(userId: string, kind: DniImageKind, sha256: string, extension: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${R2_PREFIX}/${safeUserId}/${kind}/${sha256}.${extension}`
}

export async function uploadDniImage(
  userId: string,
  kind: DniImageKind,
  dataUrl: string
): Promise<{ key: string; sha256: string; contentLength: number }> {
  const config = getR2Config()
  if (!config) throw new Error('Cloudflare R2 no está configurado')

  const { buffer, contentType, extension } = parseImageDataUrl(dataUrl)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const key = getImageKey(userId, kind, sha256, extension)
  const client = getR2Client(config)

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentType,
    CacheControl: 'private, max-age=300',
    Metadata: { sha256 },
  }))

  const stored = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
  if (stored.ContentLength !== buffer.length || stored.Metadata?.sha256 !== sha256) {
    throw new Error(`No se pudo verificar la imagen subida a R2: ${key}`)
  }

  return { key, sha256, contentLength: buffer.length }
}

export async function createDniImageUrl(key: string): Promise<string> {
  const config = getR2Config()
  if (!config) throw new Error('Cloudflare R2 no está configurado')
  if (!key.startsWith(`${R2_PREFIX}/`)) throw new Error('La ruta de imagen no es válida')

  return getSignedUrl(
    getR2Client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS }
  )
}
