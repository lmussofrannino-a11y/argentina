import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/auth'
import { db } from '@/lib/db'

const PAGE_SIZE = 20
const statusOptions = ['all', 'pending', 'approved', 'failed', 'paid', 'partial_refund_review'] as const

function parseDay(value: string | null, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const query = request.nextUrl.searchParams
    const status = query.get('status') ?? 'all'
    const pageText = query.get('page') ?? '1'
    const fromText = query.get('from')
    const toText = query.get('to')
    const from = parseDay(fromText, false)
    const to = parseDay(toText, true)
    if (!statusOptions.includes(status as typeof statusOptions[number]) ||
        !/^[1-9]\d{0,3}$/.test(pageText) || (fromText && !from) || (toText && !to) ||
        (from && to && from > to)) {
      return NextResponse.json({ error: 'Filtros no válidos' }, { status: 400 })
    }

    const where = {
      ...(status !== 'all' ? { status } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    }
    const [total, orders] = await Promise.all([
      db.paymentOrder.count({ where }),
      db.paymentOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (Number(pageText) - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, packId: true, quantity: true, amount: true, currency: true,
          status: true, createdAt: true,
          user: { select: { id: true, email: true, dni: { select: { nombre: true, apellido: true } } } },
        },
      }),
    ])
    return NextResponse.json({ orders, total, page: Number(pageText), pageSize: PAGE_SIZE }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('Error al cargar órdenes administrativas:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
