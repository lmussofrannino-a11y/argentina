import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminRequest } from '@/lib/auth'

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const issues = await db.paymentReconciliationIssue.findMany({
    where: { status: { in: ['retry', 'review'] } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ issues }, { headers: { 'Cache-Control': 'private, no-store' } })
}
