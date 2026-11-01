import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const mode = process.argv[2]
const confirmed = process.argv.includes('--confirm')
const batchSize = 5
const allowedModes = ['--upload', '--clear-inline', '--restore-inline']

if (!allowedModes.includes(mode)) {
  console.error('Uso: node --env-file=.env scripts/migrate-dni-images-to-r2.mjs --upload | --clear-inline --confirm | --restore-inline --confirm')
  process.exit(2)
}

if (mode !== '--upload' && !confirmed) {
  console.error(`${mode} modifica datos de Neon. Repetí el comando con --confirm después de revisar el resultado de --upload.`)
  process.exit(2)
}

const config = {
  accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  bucket: process.env.CLOUDFLARE_R2_BUCKET,
}
const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key)
if (missing.length) {
  console.error(`Faltan variables R2: ${missing.join(', ')}`)
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL')
  process.exit(2)
}

const prisma = new PrismaClient()
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
})

const stats = {
  rows: 0,
  uploaded: 0,
  alreadyUploaded: 0,
  cleared: 0,
  restored: 0,
  skipped: 0,
  errors: 0,
  pendingUploads: 0,
  remainingInline: 0,
  bytesUploaded: 0,
  base64BytesCleared: 0,
  base64BytesRestored: 0,
}

function parseDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Formato Base64 no reconocido (se admite PNG, JPEG o WebP)')
  const contentType = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('La imagen está vacía o supera 10 MB')
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  return { buffer, contentType, sha256, extension }
}

function objectKey(userId, kind, sha256, extension) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `dni-images/${safeUserId}/${kind}/${sha256}.${extension}`
}

async function ensureUploaded(userId, kind, value, existingKey) {
  const image = parseDataUrl(value)
  const key = objectKey(userId, kind, image.sha256, image.extension)

  const previous = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => null)
  if (previous?.Metadata?.sha256 === image.sha256 && previous.ContentLength === image.buffer.length) {
    return { key, image, uploaded: false }
  }

  await s3.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: image.buffer,
    ContentLength: image.buffer.length,
    ContentType: image.contentType,
    CacheControl: 'private, max-age=300',
    Metadata: { sha256: image.sha256 },
  }))

  const verified = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
  if (verified.Metadata?.sha256 !== image.sha256 || verified.ContentLength !== image.buffer.length) {
    throw new Error(`La verificación posterior a la subida falló para ${kind}`)
  }
  return { key, image, uploaded: true }
}

async function verifyStoredObject(key, expectedHash, expectedLength) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
  if (head.Metadata?.sha256 !== expectedHash || head.ContentLength !== expectedLength) {
    throw new Error('El objeto de R2 no coincide con la imagen original')
  }
}

async function processAsset(row, kind) {
  const valueField = kind
  const keyField = kind === 'foto' ? 'fotoStorageKey' : 'firmaStorageKey'
  const legacyValue = row[valueField]
  const storageKey = row[keyField]

  if (mode === '--restore-inline') {
    if (legacyValue !== null || !storageKey) return
    const stored = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }))
    if (!stored.Body || !stored.ContentType) throw new Error('R2 devolvió un objeto incompleto')
    const buffer = Buffer.from(await stored.Body.transformToByteArray())
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    if (stored.Metadata?.sha256 !== sha256) throw new Error('El checksum restaurado no coincide')
    const dataUrl = `data:${stored.ContentType};base64,${buffer.toString('base64')}`
    const updated = await prisma.dniData.updateMany({
      where: { userId: row.userId, [valueField]: null, [keyField]: storageKey },
      data: { [valueField]: dataUrl },
    })
    if (updated.count) stats.restored++
    else stats.skipped++
    if (updated.count) stats.base64BytesRestored += Buffer.byteLength(dataUrl, 'utf8')
    return
  }

  if (!legacyValue) return

  if (mode === '--upload') {
    const { key, image, uploaded } = await ensureUploaded(row.userId, kind, legacyValue, storageKey)
    const updated = await prisma.dniData.updateMany({
      where: { userId: row.userId, [valueField]: legacyValue, [keyField]: storageKey },
      data: { [keyField]: key },
    })
    if (updated.count === 0) {
      stats.skipped++
      console.warn(`Se omitió ${kind} de una fila modificada durante la migración.`)
      return
    }
    if (storageKey === key) stats.alreadyUploaded++
    else stats.uploaded++
    if (uploaded) stats.bytesUploaded += image.buffer.length
    return
  }

  if (!storageKey) {
    stats.skipped++
    console.warn(`Se conservó ${kind} de una fila sin clave R2 verificada.`)
    return
  }

  if (mode === '--clear-inline') {
    const image = parseDataUrl(legacyValue)
    await verifyStoredObject(storageKey, image.sha256, image.buffer.length)
    const updated = await prisma.dniData.updateMany({
      where: { userId: row.userId, [valueField]: legacyValue, [keyField]: storageKey },
      data: { [valueField]: null },
    })
    if (updated.count) {
      stats.cleared++
      stats.base64BytesCleared += Buffer.byteLength(legacyValue, 'utf8')
    } else stats.skipped++
    return
  }

}

try {
  let lastUserId = ''
  while (true) {
    const rows = await prisma.dniData.findMany({
      where: {
        userId: { gt: lastUserId },
        OR: mode === '--restore-inline'
          ? [
              { foto: null, fotoStorageKey: { not: null } },
              { firma: null, firmaStorageKey: { not: null } },
            ]
          : [{ foto: { not: null } }, { firma: { not: null } }],
      },
      orderBy: { userId: 'asc' },
      take: batchSize,
      select: {
        userId: true,
        foto: true,
        firma: true,
        fotoStorageKey: true,
        firmaStorageKey: true,
      },
    })
    if (rows.length === 0) break
    lastUserId = rows[rows.length - 1].userId
    stats.rows += rows.length

    for (const row of rows) {
      for (const kind of ['foto', 'firma']) {
        try {
          await processAsset(row, kind)
        } catch (error) {
          stats.errors++
          console.error(`Falló la migración de ${kind} en un registro. La copia original no se modificó.`, error instanceof Error ? error.message : error)
        }
      }
    }
  }

  if (mode === '--upload') {
    stats.pendingUploads = await prisma.dniData.count({
      where: {
        OR: [
          { foto: { not: null }, fotoStorageKey: null },
          { firma: { not: null }, firmaStorageKey: null },
        ],
      },
    })
  }
  if (mode === '--clear-inline') {
    stats.remainingInline = await prisma.dniData.count({
      where: { OR: [{ foto: { not: null } }, { firma: { not: null } }] },
    })
  }

  console.log(`Modo: ${mode}`)
  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors > 0 || stats.pendingUploads > 0 || stats.remainingInline > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
  s3.destroy()
}
