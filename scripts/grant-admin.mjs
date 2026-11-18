import { PrismaClient } from '@prisma/client'

// Run only from the trusted operator environment, never from a public endpoint.
// The operator selects an existing immutable user ID after verifying ownership.
const id = process.env.ADMIN_USER_ID?.trim()
if (!id) throw new Error('Set ADMIN_USER_ID to the verified existing account ID')
const db = new PrismaClient()
try {
  await db.user.update({ where: { id }, data: { isAdmin: true } })
  console.log('Administrative role assigned to the selected existing account.')
} finally { await db.$disconnect() }
