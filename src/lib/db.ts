import { PrismaClient, type Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Always acquire this before reading a balance or claiming a payment/order.
// PostgreSQL holds the row lock until the surrounding transaction commits.
export async function lockUserForTokenUpdate(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
  await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}
