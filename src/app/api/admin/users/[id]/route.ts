import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const { id } = await params
    if (!id || id.length > 128) return NextResponse.json({ error: 'ID no válido' }, { status: 400 })

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, isActive: true, activatedAt: true, createdAt: true,
        tokens: true, tokenDebt: true,
        dni: { select: { nombre: true, apellido: true, dniNumero: true } },
      },
    })
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const orders = await db.paymentOrder.findMany({
      where: { userId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { id: true, packId: true, quantity: true, amount: true, currency: true, status: true, createdAt: true },
    })

    return NextResponse.json({ user: {
      ...user,
      expiresAt: user.isActive && user.activatedAt ? new Date(user.activatedAt.getTime() + 24 * 60 * 60 * 1000) : null,
    }, orders }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Error al cargar ficha administrativa:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
