import { randomBytes, scrypt } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const KEY_LENGTH = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function hashPassword(password) {
  const salt = randomBytes(16)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) return reject(error)
      resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`)
    })
  })
}

try {
  let scanned = 0
  let migrated = 0
  let skipped = 0
  const batchSize = 100
  let cursor

  while (true) {
    const users = await prisma.user.findMany({
      select: { id: true, password: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (users.length === 0) break

    for (const user of users) {
      scanned += 1
      if (user.password.startsWith('scrypt$')) {
        skipped += 1
        continue
      }

      const newHash = await hashPassword(user.password)
      const result = await prisma.user.updateMany({
        where: { id: user.id, password: user.password },
        data: { password: newHash },
      })
      if (result.count === 1) migrated += 1
      else skipped += 1
    }

    cursor = users[users.length - 1].id
  }

  console.log(`Password migration finished. Scanned: ${scanned}; migrated: ${migrated}; skipped: ${skipped}.`)
} catch (error) {
  console.error('Password migration failed:', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
