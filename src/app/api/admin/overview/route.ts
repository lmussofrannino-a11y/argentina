import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const [total, active, withoutTokens, balances] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.user.count({ where: { tokens: { lte: 0 } } }),
      db.user.aggregate({ _sum: { tokens: true, tokenDebt: true } }),
    ])

    return NextResponse.json({ total, active, withoutTokens, tokens: balances._sum.tokens ?? 0, tokenDebt: balances._sum.tokenDebt ?? 0 }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('Error al cargar resumen administrativo:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
